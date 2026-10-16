import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SiteShell } from '../components/SiteShell'
import { AuthError, getSession } from './auth'
import { getRun, listRuns, type PageRun, RunStillGoing, startRun, waitForRun } from './pageRecon'
import {
  byType,
  bytes,
  describeFailure,
  type Finding,
  findings,
  hosts,
  keyed,
  normaliseUrl,
  type PageRequest,
  type PageResult,
  SECTION_NAMES,
  sections,
  show,
} from './pageView'
import './Debug.css'
import './Users.css'
import './Page.css'

/** The service's refusals (wwff-pagerecon docs/contract.md), in words. */
function describe(error: AuthError): string {
  switch (error.reason) {
    case 'invalid_url':
      return `That isn't a URL this tool loads: ${error.message}. Nothing was spent.`
    case 'unresolvable_host':
      return "That host doesn't resolve. Nothing was spent."
    case 'target_denied':
      return 'That host points at an internal address, which this tool never loads. Nothing was spent.'
    case 'insufficient_credits':
      return 'You have no page credits left. Ask Mike for more.'
    case 'rate_limited':
      return 'Too many runs just now (5 a minute, one at a time). Wait a moment and try again.'
    case 'host_rate_limited':
      return 'That host has been scanned a lot in the last minute. Try again shortly.'
    case 'busy':
      return 'Every browser is busy. Try again in a few seconds.'
    case 'credits_unavailable':
      return "Credits couldn't be checked just now, so nothing ran and nothing was spent. Try again shortly."
    case 'not_found':
      return 'That run has expired (runs are kept for about an hour) or never existed.'
    default:
      return `Refused: ${error.reason ?? `HTTP ${error.status}`}.`
  }
}

/** Puts the shown run in the address bar, so a reload or a shared link (to yourself) reopens it. */
function remember(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('run', id)
  else url.searchParams.delete('run')
  window.history.replaceState(null, '', url)
}

/** A run being started: what the page shows until the service answers (up to 45 s). */
function pending(url: string, fullPage: boolean): PageRun {
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    // The service will say what's wrong with it.
  }
  return {
    id: '',
    url,
    host,
    full_page: fullPage,
    status: 'running',
    created_at: new Date().toISOString(),
    completed_at: null,
    cost: 1,
    refunded: false,
    balance_after: null,
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * /tools/page/: page recon through wwff-pagerecon, for the `user` role. Loads one URL in a headless browser (an
 * active scan: the site sees a visit) for one `page` credit, refunded when the page didn't load for a reason on the
 * other side.
 */
export function PageReconPage() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') ?? '')
  const [fullPage, setFullPage] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [run, setRun] = useState<PageRun | null>(null)
  const [history, setHistory] = useState<PageRun[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Set when the page goes away, so no request outlives it and no state is set after it.
  const page = useRef({ cancelled: false })
  const historyRequest = useRef(0)
  // Only the newest run started or opened may be shown.
  const runRequest = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLElement>(null)

  const refreshHistory = useCallback(() => {
    const request = ++historyRequest.current
    listRuns().then(
      (result) => request === historyRequest.current && !page.current.cancelled && setHistory(result.runs),
      () => request === historyRequest.current && !page.current.cancelled && setHistory([]),
    )
  }, [])

  const unfinished = run !== null && (run.status === 'queued' || run.status === 'running')

  useEffect(() => {
    if (!unfinished || !run) return
    const started = Date.parse(run.created_at)
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [unfinished, run])

  const starting = run?.id === ''
  useEffect(() => {
    if (starting) results.current?.scrollIntoView({ block: 'start' })
  }, [starting])

  function claim(): { readonly cancelled: boolean } {
    const request = ++runRequest.current
    const gone = page.current
    return {
      get cancelled() {
        return gone.cancelled || request !== runRequest.current
      },
    }
  }

  async function follow(started: PageRun, signal: { readonly cancelled: boolean }) {
    setRun(started)
    remember(started.id)
    if (started.balance_after !== null) setBalance(started.balance_after)
    const finished = await waitForRun(started, signal)
    if (signal.cancelled) return
    setRun(finished)
    if (finished.balance_after !== null) setBalance(finished.balance_after)
    if (finished.refunded)
      setMessage("The page didn't load for a reason on the other side, so the credit was refunded.")
    refreshHistory()
  }

  function stepUpAndReturn() {
    const next = window.location.pathname + window.location.search
    window.location.assign(`/login/step-up/?${new URLSearchParams({ next })}`)
  }

  function failed(error: unknown, otherwise = 'The run failed. Try again.') {
    if (page.current.cancelled) return
    if (error instanceof AuthError && error.stepUp) return stepUpAndReturn()
    if (error instanceof AuthError && error.reason === 'insufficient_credits') setBalance(0)
    if (error instanceof AuthError && error.reason === 'not_found') remember(null)
    if (error instanceof RunStillGoing) {
      setMessage('Still running. It will appear in your recent runs when it finishes.')
      refreshHistory()
    } else {
      setMessage(error instanceof AuthError ? describe(error) : otherwise)
    }
  }

  async function execute(target: string, full: boolean) {
    setBusy(true)
    setMessage('')
    const previous = run
    const signal = claim()
    setRun(pending(target, full))
    try {
      const started = await startRun(target, full)
      if (signal.cancelled) {
        if (!page.current.cancelled && started.balance_after !== null) setBalance(started.balance_after)
        refreshHistory()
        return
      }
      await follow(started, signal)
    } catch (error) {
      if (signal.cancelled) return
      setRun((current) => (current?.id === '' ? previous : current))
      failed(error)
    } finally {
      if (!page.current.cancelled) setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const target = normaliseUrl(url)
    setUrl(target)
    if (target) void execute(target, fullPage)
  }

  async function open(id: string) {
    setMessage('')
    remember(id)
    const signal = claim()
    let found: PageRun | undefined
    try {
      found = await getRun(id)
      if (signal.cancelled) return
      setUrl(found.url)
      await follow(found, signal)
    } catch (error) {
      if (signal.cancelled) return
      failed(error, "Couldn't open that run. Pick it again from your recent runs.")
      if (!found && !(error instanceof AuthError && error.stepUp)) remember(run?.id || null)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival; open() reads only refs and setters.
  useEffect(() => {
    const signal = { cancelled: false }
    page.current = signal
    getSession().then(
      (session) => !signal.cancelled && setBalance(session?.credits?.balances.page ?? null),
      () => undefined,
    )
    refreshHistory()
    const linked = new URLSearchParams(window.location.search).get('run')
    if (linked) void open(linked)
    else input.current?.focus()
    return () => {
      signal.cancelled = true
    }
  }, [refreshHistory])

  const noCredits = balance === 0
  const result = run?.result

  return (
    <SiteShell page="login">
      <section className="debug-intro" aria-labelledby="page-title">
        <div className="debug-kicker">{'// TOOLS / PAGE_RECON'}</div>
        <h1 id="page-title">PAGE</h1>
        <p>
          Loads one URL in a headless browser, as a visitor would, and reports what it found: a screenshot, metadata,
          structure, links, images, styles, timings, headers, and every request the page made. It's an active scan, so
          the site sees the visit. Each run costs one page credit, refunded if the page doesn't load for a reason on the
          other side.
        </p>
        <form className="page-form" onSubmit={submit}>
          <label className="page-sr" htmlFor="page-input">
            URL
          </label>
          <input
            id="page-input"
            ref={input}
            className="users-input page-input"
            placeholder="https://example.com/pricing"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="button-primary" type="submit" disabled={busy || noCredits}>
            {busy ? 'LOADING…' : 'RUN'}
          </button>
          <label className="page-option">
            <input type="checkbox" checked={fullPage} onChange={(event) => setFullPage(event.target.checked)} />
            <span>Full-page screenshot too</span>
          </label>
        </form>
        <p className="debug-note">
          Costs 1 credit. Balance: {balance === null ? '—' : balance}
          {noCredits && ' (ask Mike for more)'}
        </p>
        <p className="debug-message" role="status" aria-live="polite">
          {message}
        </p>
      </section>

      <section ref={results} className="page-run" aria-labelledby={run ? 'page-run-title' : undefined} hidden={!run}>
        {run && (
          <>
            <div className="page-run-head">
              <h2 id="page-run-title" className="page-run-title">
                {run.host}
              </h2>
              <span className="debug-note page-run-url">{run.url}</span>
              <span className="debug-note">
                {unfinished ? `${run.status} · ${elapsed} s` : run.status}
                {run.refunded && ' · refunded'}
                {run.completed_at && ` · ${when(run.completed_at)}`}
              </span>
              {!unfinished && result && (
                <span className="page-run-actions">
                  <button
                    type="button"
                    className="debug-inline"
                    disabled={busy || noCredits}
                    onClick={() => void execute(run.url, run.full_page)}
                  >
                    Run again (1 credit)
                  </button>
                  <CopyButton label="Copy run JSON" text={() => JSON.stringify(run, null, 2)} />
                </span>
              )}
            </div>
            {unfinished || !result ? (
              <p className="debug-note page-collecting page-pad">Loading the page in a headless browser…</p>
            ) : (
              <Report run={run} result={result} />
            )}
          </>
        )}
      </section>

      {history.length > 0 && (
        <section className="panel debug-panel page-history" aria-labelledby="page-history">
          <h2 id="page-history">{'// RECENT RUNS'}</h2>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} aria-current={entry.id === run?.id || undefined}>
                <button type="button" className="debug-inline" onClick={() => void open(entry.id)}>
                  {entry.url}
                </button>
                <span className="debug-note">
                  {when(entry.created_at)}
                  {entry.status !== 'complete' && ` · ${entry.status}`}
                  {entry.refunded && ' · refunded'}
                </span>
              </li>
            ))}
          </ul>
          <p className="debug-note">Runs and their screenshots are kept for about an hour.</p>
        </section>
      )}
    </SiteShell>
  )
}

function Report({ run, result }: { run: PageRun; result: PageResult }) {
  if (!result.ok) {
    return (
      <>
        <FindingsPanel items={findings(result)} />
        <div className="debug-grid">
          <section className="panel debug-panel debug-wide" aria-label="DOCUMENT">
            <h3 className="page-h3">
              {'// DOCUMENT'} <span className="debug-fail">{(result.error?.kind ?? 'failed').toUpperCase()}</span>
            </h3>
            <p className="debug-note">
              {describeFailure(result.error)}
              {run.refunded && ' The credit was refunded.'}
            </p>
            <Requests requests={result.requests} />
            <Raw result={result} />
          </section>
        </div>
      </>
    )
  }
  const shots = result.screenshots
  return (
    <>
      <FindingsPanel items={findings(result)} />
      <div className="debug-grid">
        {shots?.viewport && (
          <section className="panel debug-panel debug-wide page-shots" aria-label="SCREENSHOT">
            <h3 className="page-h3">{'// SCREENSHOT'}</h3>
            <img
              className="page-shot"
              src={shots.viewport.url}
              width={shots.viewport.width}
              height={shots.viewport.height}
              alt={`The page at ${result.final_url ?? run.url}, as the headless browser rendered it`}
            />
            {shots.full_page && (
              <details className="page-raw">
                <summary>
                  Full page ({shots.full_page.width}×{shots.full_page.height}
                  {shots.full_page.truncated && ', cut at the cap'})
                </summary>
                <img
                  className="page-shot"
                  src={shots.full_page.url}
                  width={shots.full_page.width}
                  height={shots.full_page.height}
                  loading="lazy"
                  alt={`The whole page at ${result.final_url ?? run.url}`}
                />
              </details>
            )}
          </section>
        )}
        {sections(result).map((section) => (
          <section key={section.id} className="panel debug-panel" aria-label={section.name}>
            <h3 className="page-h3">{`// ${section.name}`}</h3>
            <dl className="debug-facts">
              {keyed(section.rows, (row) => `${row.label}`).map(({ key, item: row }) => (
                <div key={key} className="users-balance">
                  <dt>{row.label}</dt>
                  <dd className={row.tone && `page-tone-${row.tone}`} title={row.note}>
                    {show(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="panel debug-panel debug-wide" aria-label="ALL DATA">
          <h3 className="page-h3">{'// ALL DATA'}</h3>
          {result.notes.length > 0 && (
            <ul className="page-notes">
              {result.notes.map((note) => (
                <li key={note} className="debug-note">
                  {note}
                </li>
              ))}
            </ul>
          )}
          <Requests requests={result.requests} />
          <Hosts requests={result.requests} />
          <Blocked result={result} />
          <Headers result={result} />
          <Outline result={result} />
          <Links result={result} />
          <Images result={result} />
          <Meta result={result} />
          <Console result={result} />
          <Raw result={result} />
        </section>
      </div>
    </>
  )
}

function FindingsPanel({ items }: { items: Finding[] }) {
  return (
    <section className="panel debug-panel page-findings" aria-label="Findings">
      {items.length === 0 ? (
        <p className="page-tone-good">{'// NOTHING STANDS OUT'}</p>
      ) : (
        <ul>
          {keyed(items, (item) => `${item.section}:${item.text}`).map(({ key, item }) => (
            <li key={key} className={`page-tone-${item.tone}`}>
              <span className="page-finding-section">{SECTION_NAMES[item.section]}</span> {item.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A collapsible block of the full data: closed by default, with its count in the summary. */
function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details className="page-raw page-block">
      <summary>
        {title}
        {count !== undefined && ` (${count})`}
      </summary>
      <div className="page-scroll">{children}</div>
    </details>
  )
}

const cut = (text: string, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

function Requests({ requests }: { requests: PageRequest[] }) {
  const [filter, setFilter] = useState<'all' | 'third' | 'failed'>('all')
  const shown = requests.filter((q) =>
    filter === 'third' ? q.third_party : filter === 'failed' ? q.failure || (q.status ?? 0) >= 400 : true,
  )
  return (
    <Block title="Requests" count={requests.length}>
      <p className="debug-note page-filters">
        {(['all', 'third', 'failed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className="debug-inline"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'third' ? 'Third-party' : 'Failed'}
          </button>
        ))}
        <span>
          {byType(requests)
            .map((t) => `${t.type} ${t.requests}`)
            .join(' · ')}
        </span>
      </p>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Status</th>
            <th>Size</th>
            <th>Host</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {keyed(shown, (q) => `${q.url}`).map(({ key, item: q }) => (
            <tr key={key} className={q.third_party ? 'page-third' : undefined}>
              <td>{q.type}</td>
              <td className={q.failure || (q.status ?? 0) >= 400 ? 'page-tone-warn' : undefined}>
                {q.status ?? q.failure ?? '—'}
              </td>
              <td>{bytes(q.bytes) ?? '—'}</td>
              <td>
                {q.host}
                {q.third_party && ' ³ᵖ'}
              </td>
              <td className="debug-mono" title={q.url}>
                {cut(q.url)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

function Hosts({ requests }: { requests: PageRequest[] }) {
  const rows = hosts(requests)
  return (
    <Block title="Hosts" count={rows.length}>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Host</th>
            <th>Party</th>
            <th>Requests</th>
            <th>Size</th>
            <th>Types</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.host}>
              <th scope="row">{h.host}</th>
              <td>{h.third_party ? 'third' : 'first'}</td>
              <td>{h.requests}</td>
              <td>{bytes(h.bytes)}</td>
              <td>{h.types}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

function Blocked({ result }: { result: PageResult }) {
  if (!result.blocked.length) return null
  return (
    <Block title="Refused by the network policy" count={result.blocked.length}>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Host</th>
            <th>Port</th>
            <th>Address</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {keyed(result.blocked, (b) => `${b.host}:${b.port}`).map(({ key, item: b }) => (
            <tr key={key}>
              <th scope="row">{b.host}</th>
              <td>{b.port}</td>
              <td>{b.ip ?? '—'}</td>
              <td>{b.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

function Headers({ result }: { result: PageResult }) {
  const headers = result.document?.headers ?? []
  return (
    <Block title="Response headers" count={headers.length}>
      <table className="debug-table">
        <tbody>
          {keyed(headers, ([name]) => `${name}`).map(({ key, item: [name, value] }) => (
            <tr key={key}>
              <th scope="row">{name}</th>
              <td className="debug-mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.csp?.violations.length ? (
        <table className="debug-table">
          <caption>CSP violations</caption>
          <tbody>
            {keyed(result.csp.violations, (v) => `${v.blocked}`).map(({ key, item: v }) => (
              <tr key={key}>
                <th scope="row">{v.directive ?? '—'}</th>
                <td className="debug-mono">{v.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Block>
  )
}

function Outline({ result }: { result: PageResult }) {
  const s = result.structure
  if (!s) return null
  return (
    <Block title="Headings and landmarks" count={s.headings.length}>
      <ol className="page-outline">
        {keyed(s.headings, (h) => `${h.level}`).map(({ key, item: h }) => (
          <li key={key} className={`page-outline-h${h.level}`}>
            <span className="debug-note">h{h.level}</span> {h.text || '(empty)'}
          </li>
        ))}
      </ol>
      <p className="debug-note">
        Landmarks: {s.landmarks.map((l) => (l.label ? `${l.role} “${l.label}”` : l.role)).join(', ') || 'none'}
      </p>
    </Block>
  )
}

function Links({ result }: { result: PageResult }) {
  const links = result.links ?? []
  return (
    <Block title="Links" count={links.length}>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Text</th>
            <th>Where</th>
            <th>rel / target</th>
            <th>Checked</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {keyed(links, (l) => l.href).map(({ key, item: l }) => (
            <tr key={key}>
              <td>{cut(l.text || '(no text)', 40)}</td>
              <td>{l.internal ? 'internal' : l.scheme === 'http' || l.scheme === 'https' ? 'external' : l.scheme}</td>
              <td>{[...l.rel, l.target].filter(Boolean).join(' ') || '—'}</td>
              <td className={l.status !== null && (l.status === 0 || l.status >= 400) ? 'page-tone-warn' : undefined}>
                {l.status === null ? '—' : l.status || 'no answer'}
              </td>
              <td className="debug-mono" title={l.href}>
                {cut(l.href, 70)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

function Images({ result }: { result: PageResult }) {
  const images = result.images ?? []
  return (
    <Block title="Images" count={images.length}>
      <table className="debug-table">
        <thead>
          <tr>
            <th>Alt</th>
            <th>Format</th>
            <th>Size</th>
            <th>Shown / natural</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {keyed(images, (img) => `${img.src}`).map(({ key, item: img }) => (
            <tr key={key}>
              <td className={img.has_alt ? undefined : 'page-tone-warn'}>
                {img.has_alt ? cut(img.alt || '(empty: decorative)', 40) : 'missing'}
              </td>
              <td>{img.format ?? '—'}</td>
              <td>{bytes(img.bytes) ?? '—'}</td>
              <td>
                {img.width ?? '?'}×{img.height ?? '?'} / {img.natural_width ?? '?'}×{img.natural_height ?? '?'}
              </td>
              <td className="debug-mono" title={img.src}>
                {cut(img.src, 60)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  )
}

function Meta({ result }: { result: PageResult }) {
  const m = result.metadata
  if (!m) return null
  return (
    <Block title="Meta tags and JSON-LD" count={m.meta.length + m.json_ld.length}>
      <table className="debug-table">
        <tbody>
          {keyed(m.meta, (entry) => `${entry.key}`).map(({ key, item: entry }) => (
            <tr key={key}>
              <th scope="row">{entry.key}</th>
              <td className="debug-mono">{entry.content ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {keyed(m.json_ld, () => 'ld').map(({ key, item: ld }) => (
        <pre key={key} className="debug-raw">
          {ld.valid ? (JSON.stringify(ld.data, null, 2) ?? '(too large to keep)') : '(invalid JSON-LD)'}
        </pre>
      ))}
    </Block>
  )
}

function Console({ result }: { result: PageResult }) {
  if (!result.console_errors.length) return null
  return (
    <Block title="Console errors" count={result.console_errors.length}>
      <pre className="debug-raw">{result.console_errors.join('\n')}</pre>
    </Block>
  )
}

function Raw({ result }: { result: PageResult }) {
  return (
    <div className="page-raw-row">
      <details className="page-raw">
        <summary>Full result</summary>
        <pre className="debug-raw">{JSON.stringify(result, null, 2)}</pre>
      </details>
      <CopyButton label="Copy JSON" text={() => JSON.stringify(result, null, 2)} />
    </div>
  )
}

function CopyButton({ label, text }: { label: string; text: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="debug-inline"
      onClick={() =>
        navigator.clipboard.writeText(text()).then(
          () => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          },
          () => undefined,
        )
      }
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
