import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { SiteShell } from '../components/SiteShell'
import { AuthError, getSession } from './auth'
import {
  CHECKS,
  type Check,
  type CollectionResult,
  getRun,
  listRuns,
  type Run,
  RunStillGoing,
  startRun,
  waitForRun,
} from './recon'
import { compareRuns, jsonDiff, runLabel } from './reconCompare'
import { exportName, reportHtml } from './reconReport'
import { findings, normaliseDomain, show, summary, type Tone, visibleRows } from './reconView'
import './Debug.css'
import './Users.css'
import './Domain.css'

/** The service's refusals (wwff-recon docs/contract.md), in words. */
function describe(error: AuthError): string {
  switch (error.reason) {
    case 'invalid_domain':
      return "That isn't a domain name this tool can check (no IP addresses or single labels). Nothing was spent."
    case 'insufficient_credits':
      return 'You have no domain credits left. Ask Mike for more.'
    case 'rate_limited':
      return 'Too many runs just now. Wait a minute and try again.'
    case 'credits_unavailable':
      return "Credits couldn't be checked just now, so nothing ran and nothing was spent. Try again shortly."
    case 'not_found':
      return 'That run has expired (runs are kept for 90 days) or never existed.'
    default:
      return `Refused: ${error.reason ?? `HTTP ${error.status}`}.`
  }
}

/**
 * Puts the shown run (`run`) and the one it is compared with (`vs`) in the address bar, so a reload or a shared link
 * (to yourself) reopens them.
 */
function remember(id: string | null, param: 'run' | 'vs' = 'run') {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(param, id)
  else url.searchParams.delete(param)
  window.history.replaceState(null, '', url)
}

/** Hands the browser a file to save: a blob URL and a download link, which the site's CSP has no say over. */
function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** How many recent runs the page lists, and so can compare: the service's maximum. */
const HISTORY = 100

/** A run being started: what the page shows until the service answers (up to 45 s). */
function pending(domain: string, checks: Check[]): Run {
  return {
    id: '',
    domain,
    domain_unicode: domain,
    domain_a_label: domain,
    checks,
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
 * /tools/domain/: domain recon (RDAP, DNS, TLS, HTTP headers) through wwff-recon, for the `user` role. Each run spends
 * one `domain` credit, refunded when every check failed for an upstream reason.
 */
export function DomainPage() {
  const [domain, setDomain] = useState(() => new URLSearchParams(window.location.search).get('domain') ?? '')
  const [checks, setChecks] = useState<Check[]>(CHECKS.map((check) => check.id))
  const [balance, setBalance] = useState<number | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  // The run the shown one is compared with, if any.
  const [versus, setVersus] = useState<Run | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Set when the page goes away, so no request outlives it and no state is set after it.
  const page = useRef({ cancelled: false })
  // Only the newest history request may replace the list.
  const historyRequest = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLElement>(null)

  const refreshHistory = useCallback(() => {
    const request = ++historyRequest.current
    listRuns({ limit: HISTORY }).then(
      (result) => request === historyRequest.current && !page.current.cancelled && setHistory(result.runs),
      () => request === historyRequest.current && !page.current.cancelled && setHistory([]),
    )
  }, [])

  const unfinished = run !== null && (run.status === 'queued' || run.status === 'running')

  // Seconds since the shown run started, while it's unfinished, so a 30 s run doesn't look stuck.
  useEffect(() => {
    if (!unfinished || !run) return
    const started = Date.parse(run.created_at)
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [unfinished, run])

  // A run just started: bring its panels into view (on a phone they're below the form). After the render, so the
  // section is no longer hidden.
  const starting = run?.id === ''
  useEffect(() => {
    if (starting) results.current?.scrollIntoView({ block: 'start' })
  }, [starting])

  /** Shows a run, polling it while it's unfinished; the balance it reports applies at once (a credit is spent). */
  async function follow(started: Run) {
    const signal = page.current
    setRun(started)
    remember(started.id)
    if (started.balance_after !== null) setBalance(started.balance_after)
    const finished = await waitForRun(started, signal)
    if (signal.cancelled) return
    setRun(finished)
    if (finished.balance_after !== null) setBalance(finished.balance_after)
    if (finished.refunded) setMessage('Every check failed upstream, so the credit was refunded.')
    refreshHistory()
  }

  /**
   * The tool's role has lapsed: the step-up page asks for the proof it needs (a passkey, or a fresh sign-in), then
   * comes back here with the address bar's `?run=`, so the run being shown or opened reopens.
   */
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

  async function execute(target: string, selected: Check[]) {
    setBusy(true)
    setMessage('')
    // "Run again" replaces the run on show; if the new one never starts, that one comes back.
    const previous = run
    const previousVersus = versus
    setRun(pending(target, selected))
    compareWith(null)
    try {
      const started = await startRun(target, selected)
      if (page.current.cancelled) return
      // The same domain again: the new run is shown against the one it replaces.
      if (previous?.results && previous.domain_a_label === started.domain_a_label) compareWith(previous)
      await follow(started)
    } catch (error) {
      if (!page.current.cancelled && previousVersus) compareWith(previousVersus)
      // Nothing to show for a run that never started: back to what was shown before it.
      if (!page.current.cancelled) setRun((current) => (current?.id === '' ? previous : current))
      failed(error)
    } finally {
      if (!page.current.cancelled) setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // A pasted URL keeps only its host; the field shows what was actually checked.
    const target = normaliseDomain(domain)
    setDomain(target)
    if (target) void execute(target, checks)
  }

  function compareWith(other: Run | null) {
    setVersus(other)
    remember(other?.id || null, 'vs')
  }

  /** Loads a run to compare the shown one with (a summary from the list has no results). */
  async function openVersus(id: string) {
    if (!id) return compareWith(null)
    setMessage('')
    remember(id, 'vs')
    try {
      const other = await getRun(id)
      if (!page.current.cancelled) compareWith(other)
    } catch (error) {
      if (page.current.cancelled) return
      // A run to compare with that has gone leaves the shown run alone (failed() would clear it from the address bar).
      if (error instanceof AuthError && error.reason === 'not_found') {
        setMessage(describe(error))
        compareWith(null)
        return
      }
      failed(error, "Couldn't open that run to compare. Pick it again.")
      if (!(error instanceof AuthError && error.stepUp)) compareWith(null)
    }
  }

  async function open(id: string, keepVersus = false) {
    setMessage('')
    if (!keepVersus) compareWith(null)
    // In the address bar before the request, so a step-up on the way comes back to this run (a 404 clears it).
    remember(id)
    let found: Run | undefined
    try {
      found = await getRun(id)
      if (page.current.cancelled) return
      setDomain(found.domain_unicode)
      // A run still queued or running keeps being polled, like a new one.
      await follow(found)
    } catch (error) {
      failed(error, "Couldn't open that run. Pick it again from your recent runs.")
      // It never loaded, so the run from before is still shown: the address bar goes back to it (unless step-up is
      // taking us away).
      if (!found && !(error instanceof AuthError && error.stepUp)) remember(run?.id || null)
    }
  }

  // Signed-in state, the recent runs, and the run in the address bar, if there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival; open() reads only refs and setters.
  useEffect(() => {
    const signal = { cancelled: false }
    page.current = signal
    getSession().then(
      (session) => !signal.cancelled && setBalance(session?.credits?.balances.domain ?? null),
      () => undefined,
    )
    refreshHistory()
    const params = new URLSearchParams(window.location.search)
    const linked = params.get('run')
    const against = params.get('vs')
    if (linked) {
      void open(linked, true).then(() => {
        if (against && !signal.cancelled) void openVersus(against)
      })
    } else input.current?.focus()
    return () => {
      signal.cancelled = true
    }
  }, [refreshHistory])

  function toggle(check: Check, on: boolean) {
    setChecks((current) =>
      on
        ? CHECKS.map((entry) => entry.id).filter((id) => id === check || current.includes(id))
        : current.filter((id) => id !== check),
    )
  }

  const noCredits = balance === 0
  const flagged = run ? findings(run.checks, run.results) : []

  return (
    <SiteShell page="login">
      <section className="debug-intro" aria-labelledby="domain-title">
        <div className="debug-kicker">{'// TOOLS / DOMAIN_RECON'}</div>
        <h1 id="domain-title">DOMAIN</h1>
        <p>
          Registration, DNS, TLS, and HTTP headers for a domain, collected live. Each run costs one domain credit, and
          is refunded if every check fails for a reason on the other side.
        </p>
        <form className="domain-form" onSubmit={submit}>
          <label className="domain-sr" htmlFor="domain-input">
            Domain
          </label>
          <input
            id="domain-input"
            ref={input}
            className="users-input domain-input"
            placeholder="example.com, or paste a URL"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="url"
            required
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          <button className="button-primary" type="submit" disabled={busy || checks.length === 0 || noCredits}>
            {busy ? 'RUNNING…' : 'RUN'}
          </button>
          <fieldset className="domain-checks">
            <legend className="domain-sr">Checks</legend>
            {CHECKS.map((check) => (
              <label key={check.id} className="domain-check">
                <input
                  type="checkbox"
                  checked={checks.includes(check.id)}
                  onChange={(event) => toggle(check.id, event.target.checked)}
                />
                <span>
                  {check.name}
                  <span className="domain-check-blurb">{check.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
        <p className="debug-note">
          Costs 1 credit, whichever checks you pick. Balance: {balance === null ? '—' : balance}
          {noCredits && ' (ask Mike for more)'}
          {checks.length === 0 && ' · Pick at least one check.'}
        </p>
        <p className="debug-message" role="status" aria-live="polite">
          {message}
        </p>
      </section>

      <section
        ref={results}
        className="domain-run"
        aria-labelledby={run ? 'domain-run-title' : undefined}
        hidden={!run}
      >
        {run && (
          <>
            <div className="domain-run-head">
              <h2 id="domain-run-title" className="domain-run-title">
                {run.domain_unicode}
                {run.domain_a_label !== run.domain_unicode && (
                  <span className="debug-note"> ({run.domain_a_label})</span>
                )}
              </h2>
              <span className="debug-note">
                {unfinished ? `${run.status} · ${elapsed} s` : run.status}
                {run.refunded && ' · refunded'}
                {run.completed_at && ` · ${when(run.completed_at)}`}
              </span>
              {!unfinished && run.results && (
                <span className="domain-run-actions">
                  <button
                    type="button"
                    className="debug-inline"
                    disabled={busy || noCredits}
                    onClick={() => void execute(run.domain_unicode, run.checks)}
                  >
                    Run again (1 credit)
                  </button>
                  <CopyButton label="Copy run JSON" text={() => JSON.stringify(run, null, 2)} />
                  <button
                    type="button"
                    className="debug-inline"
                    onClick={() => download(exportName(run, 'json'), 'application/json', JSON.stringify(run, null, 2))}
                  >
                    Download JSON
                  </button>
                  <button
                    type="button"
                    className="debug-inline"
                    onClick={() => download(exportName(run, 'html'), 'text/html', reportHtml(run))}
                  >
                    Download report
                  </button>
                </span>
              )}
            </div>
            {!unfinished && run.results && (
              <ComparePicker run={run} versus={versus} history={history} onPick={(id) => void openVersus(id)} />
            )}
            {!unfinished && run.results && versus?.results && (
              <Comparison
                // Earlier on the left, whichever was picked first.
                before={Date.parse(versus.created_at) <= Date.parse(run.created_at) ? versus : run}
                after={Date.parse(versus.created_at) <= Date.parse(run.created_at) ? run : versus}
                onClose={() => compareWith(null)}
              />
            )}
            {!unfinished && run.results && <Findings items={flagged} />}
            <div className="debug-grid">
              {run.checks.map((check) => (
                <Result key={check} check={check} result={run.results?.[check]} />
              ))}
            </div>
          </>
        )}
      </section>

      {history.length > 0 && (
        <section className="panel debug-panel domain-history" aria-labelledby="domain-history">
          <h2 id="domain-history">{'// RECENT RUNS'}</h2>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} aria-current={entry.id === run?.id || undefined}>
                <button type="button" className="debug-inline" onClick={() => void open(entry.id)}>
                  {entry.domain_unicode}
                </button>
                <span className="debug-note">
                  {when(entry.created_at)} ·{' '}
                  {entry.checks.length === CHECKS.length ? 'all checks' : entry.checks.join(', ')}
                  {entry.status !== 'complete' && ` · ${entry.status}`}
                  {entry.refunded && ' · refunded'}
                </span>
              </li>
            ))}
          </ul>
          <p className="debug-note">
            Runs are kept for 90 days (the newest {HISTORY} are listed). Open one, then compare it with another.
          </p>
        </section>
      )}
    </SiteShell>
  )
}

function Findings({ items }: { items: ReturnType<typeof findings> }) {
  const name = (check: Check) => CHECKS.find((entry) => entry.id === check)?.name ?? check
  return (
    <section className="panel debug-panel domain-findings" aria-label="Findings">
      {items.length === 0 ? (
        <p className="domain-tone-good">{'// NOTHING STANDS OUT'}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.check}:${item.text}`} className={`domain-tone-${item.tone}`}>
              <span className="domain-finding-check">{name(item.check)}</span> {item.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ComparePicker({
  run,
  versus,
  history,
  onPick,
}: {
  run: Run
  versus: Run | null
  history: Run[]
  onPick: (id: string) => void
}) {
  const others = history.filter(
    (entry) => entry.id !== run.id && entry.status !== 'running' && entry.status !== 'queued',
  )
  if (others.length === 0 && !versus) return null
  // The same domain's runs first: comparing a domain with itself over time is the usual case.
  const same = others.filter((entry) => entry.domain_a_label === run.domain_a_label)
  const rest = others.filter((entry) => entry.domain_a_label !== run.domain_a_label)
  return (
    <div className="domain-compare-pick">
      <label htmlFor="domain-versus">Compare with</label>
      <select
        id="domain-versus"
        className="users-input domain-select"
        value={versus?.id ?? ''}
        onChange={(event) => onPick(event.target.value)}
      >
        <option value="">— nothing —</option>
        {versus && !others.some((entry) => entry.id === versus.id) && (
          <option value={versus.id}>{runLabel(versus)}</option>
        )}
        {same.length > 0 && (
          <optgroup label={`${run.domain_unicode}, other runs`}>
            {same.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {runLabel(entry)}
              </option>
            ))}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label="Other domains">
            {rest.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {runLabel(entry)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

const OUTCOME = (outcome: string | null) =>
  outcome === null ? 'not run' : outcome === 'ok' ? 'OK' : outcome.toUpperCase()

function Comparison({ before, after, onClose }: { before: Run; after: Run; onClose: () => void }) {
  const [changedOnly, setChangedOnly] = useState(false)
  const diff = compareRuns(before, after)
  const raw = jsonDiff(before.results ?? {}, after.results ?? {})
  const name = (check: Check) => CHECKS.find((entry) => entry.id === check)?.name ?? check
  const tone = (value: Tone | undefined) => (value ? `domain-tone-${value}` : undefined)
  const { appeared, cleared, kept } = diff.findings
  const outcomes = diff.checks.filter((check) => check.before !== check.after).length
  return (
    <section className="panel debug-panel domain-compare" aria-labelledby="domain-compare-title">
      <div className="domain-compare-head">
        <h3 id="domain-compare-title" className="domain-h3">
          {'// COMPARE'}
        </h3>
        <span className="debug-note">
          {diff.changedRows === 0 && outcomes === 0 && appeared.length === 0 && cleared.length === 0
            ? 'no differences in the summaries'
            : [
                outcomes > 0 && `${outcomes} check${outcomes === 1 ? '' : 's'} with a different outcome`,
                `${diff.changedRows} row${diff.changedRows === 1 ? '' : 's'} changed`,
                `${appeared.length} finding${appeared.length === 1 ? '' : 's'} appeared`,
                `${cleared.length} cleared`,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        <label className="domain-check">
          <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
          <span>Changed only</span>
        </label>
        <button type="button" className="debug-inline" onClick={onClose}>
          Close
        </button>
      </div>
      {(appeared.length > 0 || cleared.length > 0 || kept.length > 0) && (
        <ul className="domain-compare-findings" aria-label="Findings compared">
          {appeared.map((item) => (
            <li key={`+${item.check}:${item.text}`} className={`domain-tone-${item.tone}`}>
              <span className="domain-diff-mark">appeared</span>{' '}
              <span className="domain-finding-check">{name(item.check)}</span> {item.text}
            </li>
          ))}
          {cleared.map((item) => (
            <li key={`-${item.check}:${item.text}`} className="domain-tone-good">
              <span className="domain-diff-mark">cleared</span>{' '}
              <span className="domain-finding-check">{name(item.check)}</span> <s>{item.text}</s>
            </li>
          ))}
          {kept.length > 0 && (
            <li className="debug-note">
              {kept.length} finding{kept.length === 1 ? '' : 's'} in both
            </li>
          )}
        </ul>
      )}
      <div className="domain-compare-scroll">
        <table className="domain-compare-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">{runLabel(before)}</th>
              <th scope="col">{runLabel(after)}</th>
            </tr>
          </thead>
          {diff.checks.map((check) => {
            const rows = changedOnly ? check.rows.filter((row) => row.changed) : check.rows
            const outcomeChanged = check.before !== check.after
            if (changedOnly && rows.length === 0 && !outcomeChanged) return null
            return (
              <tbody key={check.check}>
                <tr className={outcomeChanged ? 'domain-diff-changed' : undefined}>
                  <th scope="rowgroup" className="domain-compare-check">
                    {name(check.check)}
                  </th>
                  <td>{OUTCOME(check.before)}</td>
                  <td>{OUTCOME(check.after)}</td>
                </tr>
                {rows.map((row) => (
                  <tr key={row.label} className={row.changed ? 'domain-diff-changed' : undefined}>
                    <th scope="row">{row.label}</th>
                    <td className={tone(row.beforeTone)}>{show(row.before)}</td>
                    <td className={tone(row.afterTone)}>{show(row.after)}</td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>
      <div className="domain-raw-row">
        <details className="domain-raw">
          <summary>
            Raw JSON diff ({raw.length} change{raw.length === 1 ? '' : 's'}, timings left out)
          </summary>
          <pre className="debug-raw domain-diff-pre">
            {raw.length === 0
              ? 'The results are the same.'
              : raw
                  .map((change) =>
                    change.kind === 'added'
                      ? `+ ${change.path}: ${JSON.stringify(change.after)}`
                      : change.kind === 'removed'
                        ? `- ${change.path}: ${JSON.stringify(change.before)}`
                        : `~ ${change.path}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`,
                  )
                  .join('\n')}
          </pre>
        </details>
        <CopyButton
          label="Copy diff JSON"
          text={() => JSON.stringify({ before: before.id, after: after.id, changes: raw }, null, 2)}
        />
      </div>
    </section>
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

function Result({ check, result }: { check: Check; result: CollectionResult | undefined }) {
  const name = CHECKS.find((entry) => entry.id === check)?.name ?? check
  return (
    <section className="panel debug-panel" aria-label={name} aria-busy={!result || undefined}>
      <h3 className="domain-h3">
        {`// ${name}`}
        {result && (
          <span className={result.ok ? 'debug-pass' : 'debug-fail'}>
            {' '}
            {result.ok ? 'OK' : (result.error?.kind ?? 'FAILED').toUpperCase()}
          </span>
        )}
        {result && <span className="debug-note"> {Math.round(result.duration_ms)} ms</span>}
      </h3>
      {!result ? (
        <p className="debug-note domain-collecting">Collecting…</p>
      ) : result.ok && result.data ? (
        <dl className="debug-facts">
          {visibleRows(summary(check, result.data)).map((row) => (
            <div key={row.label} className="users-balance">
              <dt>{row.label}</dt>
              <dd className={row.tone && `domain-tone-${row.tone}`} title={row.note}>
                {show(row.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="debug-note">
          {result.error?.message ?? 'No data.'}
          {result.error?.retryable && ' (a temporary failure on the other side)'}
        </p>
      )}
      {result && (
        <div className="domain-raw-row">
          <details className="domain-raw">
            <summary>Full result</summary>
            <pre className="debug-raw">{JSON.stringify(result, null, 2)}</pre>
          </details>
          <CopyButton label="Copy JSON" text={() => JSON.stringify(result, null, 2)} />
        </div>
      )}
    </section>
  )
}
