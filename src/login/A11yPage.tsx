import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SiteShell } from '../components/SiteShell'
import {
  apca,
  auditSummary,
  automatedLevel,
  contrast,
  criteria,
  grade,
  IMPACT_TONE,
  pairOf,
  parseColour,
  parsePalette,
  REQUIREMENTS,
  type Rgb,
  resolvePair,
  showRatio,
  simulate,
  suggest,
  toHex,
  VISIONS,
} from './a11y'
import { AuthError, getSession } from './auth'
import { getRun, listRuns, type PageRun, RunStillGoing, startRun, waitForRun } from './pageRecon'
import { type Accessibility, type AxeRule, keyed, normaliseUrl } from './pageView'
import './Debug.css'
import './Users.css'
import './Page.css'
import './A11y.css'

/**
 * A colour as the browser reads it: what parseColour knows, else a CSS colour name (or any syntax the browser has
 * and this page doesn't), resolved through a detached element's computed style. Undefined when it isn't a colour.
 */
function resolveColour(text: string): Rgb | undefined {
  const parsed = parseColour(text)
  if (parsed || typeof CSS === 'undefined' || !CSS.supports('color', text.trim())) return parsed
  const probe = document.createElement('span')
  probe.style.color = text.trim()
  probe.hidden = true
  document.body.append(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return parseColour(computed)
}

/** The page recon service's refusals, in this tool's words (wwff-pagerecon docs/contract.md). */
function describe(error: AuthError): string {
  switch (error.reason) {
    case 'invalid_url':
      return `That isn't a URL the audit loads: ${error.message}. Nothing was spent.`
    case 'unresolvable_host':
      return "That host doesn't resolve. Nothing was spent."
    case 'target_denied':
      return 'That host points at an internal address, which is never loaded. Nothing was spent.'
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
      return 'That run has expired (page runs are kept for about an hour) or never existed.'
    case 'tool_forbidden':
      return 'Audits are page recon runs, and your account has no page recon access.'
    default:
      return `Refused: ${error.reason ?? `HTTP ${error.status}`}.`
  }
}

/** The query string holds what's on screen (fg, bg, run), so a reload or a link keeps it. */
function remember(values: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  window.history.replaceState(null, '', url)
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * /tools/a11y/: accessibility (WCAG 2.2), for the `user` role. A contrast checker and palette grid that run in the
 * browser for nothing, and page audits: a page recon run (wwff-pagerecon, axe-core in its headless browser) for one
 * `page` credit, read here for what matters to accessibility.
 */
export function A11yPage() {
  const query = new URLSearchParams(window.location.search)
  const [fg, setFg] = useState(() => query.get('fg') ?? '#767676')
  const [bg, setBg] = useState(() => query.get('bg') ?? '#ffffff')
  const checker = useRef<HTMLElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => remember({ fg, bg }), 300)
    return () => window.clearTimeout(timer)
  }, [fg, bg])

  const check = useCallback((pair: { fg: string; bg: string }) => {
    setFg(pair.fg)
    setBg(pair.bg)
    checker.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  return (
    <SiteShell page="login">
      <section className="debug-intro" aria-labelledby="a11y-title">
        <div className="debug-kicker">{'// TOOLS / ACCESSIBILITY'}</div>
        <h1 id="a11y-title">A11Y</h1>
        <p>
          WCAG 2.2 checks. The contrast checker and palette grid run here in your browser and cost nothing. A page audit
          loads the URL in a headless browser and runs axe-core over it, as a page recon run: one page credit.
        </p>
        <p className="debug-note">
          Automated checks find perhaps a third of what WCAG asks. A clean audit means nothing obvious is wrong, not
          that the page conforms: keyboard use, reading order, and whether text alternatives make sense still need a
          person.
        </p>
      </section>
      <div className="debug-grid">
        <Checker ref={checker} fg={fg} bg={bg} setFg={setFg} setBg={setBg} />
        <Palette onPick={check} />
        <Audit onCheck={check} />
      </div>
    </SiteShell>
  )
}

function ColourField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const colour = resolveColour(value)
  return (
    <div className="a11y-field">
      <label htmlFor={id}>{label}</label>
      <div className="a11y-field-row">
        <input
          id={id}
          className="users-input a11y-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!colour || undefined}
          aria-describedby={colour ? undefined : `${id}-error`}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="color"
          className="a11y-picker"
          aria-label={`${label}: pick`}
          value={colour ? toHex({ ...colour, a: 1 }) : '#000000'}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {!colour && (
        <p id={`${id}-error`} className="debug-note page-tone-warn">
          Not a colour: try #767676, rgb(118 118 118), hsl(0 0% 46%), or a CSS name.
        </p>
      )}
    </div>
  )
}

function Checker({
  ref,
  fg,
  bg,
  setFg,
  setBg,
}: {
  ref: React.Ref<HTMLElement>
  fg: string
  bg: string
  setFg: (value: string) => void
  setBg: (value: string) => void
}) {
  const text = resolveColour(fg)
  const back = resolveColour(bg)
  const pair = text && back ? resolvePair(text, back) : undefined
  const ratio = text && back ? contrast(text, back) : undefined
  return (
    <section ref={ref} className="panel debug-panel debug-wide" aria-labelledby="a11y-contrast-title">
      <h2 id="a11y-contrast-title" className="page-h3">
        {'// CONTRAST'}
      </h2>
      <div className="a11y-checker">
        <div className="a11y-fields">
          <ColourField id="a11y-fg" label="Text" value={fg} onChange={setFg} />
          <button
            type="button"
            className="debug-inline a11y-swap"
            onClick={() => {
              setFg(bg)
              setBg(fg)
            }}
          >
            Swap ⇅
          </button>
          <ColourField id="a11y-bg" label="Background" value={bg} onChange={setBg} />
        </div>
        {text && back && pair && ratio !== undefined && (
          <>
            <div
              className="a11y-sample"
              style={{ color: toHex(pair.fg), backgroundColor: toHex(pair.bg), borderColor: toHex(pair.fg) }}
            >
              <p className="a11y-sample-large">Large text, 24px</p>
              <p className="a11y-sample-bold">Bold large text, 18.66px</p>
              <p className="a11y-sample-normal">
                Body text at 16px: the quick brown fox jumps over the lazy dog. 0123456789
              </p>
              <p className="a11y-sample-small">Small print at 12px, which still needs 4.5:1.</p>
            </div>
            <div className="a11y-verdict">
              <p className={`a11y-ratio page-tone-${grade(ratio).tone}`} aria-live="polite">
                {showRatio(ratio)}
                <span className="debug-note"> {grade(ratio).label}</span>
              </p>
              <table className="debug-table a11y-levels">
                <caption className="page-sr">
                  What each WCAG contrast criterion asks, and whether this pair meets it
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col">For</th>
                    <th scope="col">Needs</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {REQUIREMENTS.map((need) => (
                    <tr key={need.id}>
                      <th scope="row">
                        {need.criterion} {need.level}
                      </th>
                      <td>{need.what}</td>
                      <td>{need.min}:1</td>
                      <td className={ratio >= need.min ? 'page-tone-good' : 'page-tone-bad'}>
                        {ratio >= need.min ? 'pass' : 'fail'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="debug-note">
                APCA Lc {Math.round(apca(pair.fg, pair.bg))} (the WCAG 3 draft's measure; informative only). Large text
                is 24px, or 18.66px bold.
                {(text.a < 1 || back.a < 1) && ' Translucent colours are measured over a white page.'}
              </p>
            </div>
            <Suggestions text={text} back={back} ratio={ratio} setFg={setFg} setBg={setBg} />
            <Visions fg={pair.fg} bg={pair.bg} />
          </>
        )}
      </div>
    </section>
  )
}

function Suggestions({
  text,
  back,
  ratio,
  setFg,
  setBg,
}: {
  text: Rgb
  back: Rgb
  ratio: number
  setFg: (value: string) => void
  setBg: (value: string) => void
}) {
  const targets = [
    { min: 4.5, label: 'AA text' },
    { min: 7, label: 'AAA text' },
  ].filter((target) => ratio < target.min)
  if (!targets.length) return null
  return (
    <div className="a11y-suggest">
      <h3 className="debug-note">Nearest colours that pass</h3>
      <ul>
        {targets.map((target) => {
          const textFix = suggest(text, back, target.min, 'fg')[0]
          const backFix = suggest(text, back, target.min, 'bg')[0]
          return (
            <li key={target.min}>
              <span className="a11y-suggest-label">{target.label}:</span>
              {textFix ? (
                <button type="button" className="debug-inline" onClick={() => setFg(textFix.colour)}>
                  <Swatch colour={textFix.colour} /> text {textFix.colour} ({showRatio(textFix.ratio)})
                </button>
              ) : (
                <span className="debug-note">no text colour gets there on this background</span>
              )}
              {backFix && (
                <button type="button" className="debug-inline" onClick={() => setBg(backFix.colour)}>
                  <Swatch colour={backFix.colour} /> or background {backFix.colour} ({showRatio(backFix.ratio)})
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Swatch({ colour, label }: { colour: string; label?: string }) {
  return <span className="a11y-swatch" style={{ backgroundColor: colour }} aria-hidden={!label} title={label} />
}

function Visions({ fg, bg }: { fg: Rgb; bg: Rgb }) {
  return (
    <div className="a11y-visions">
      <h3 className="debug-note">The same pair with a colour-vision deficiency (simulated)</h3>
      <ul>
        {VISIONS.map((vision) => {
          const text = simulate(fg, vision.id)
          const back = simulate(bg, vision.id)
          const ratio = contrast(text, back)
          return (
            <li key={vision.id}>
              <span className="a11y-vision-sample" style={{ color: toHex(text), backgroundColor: toHex(back) }}>
                Aa
              </span>
              <span>
                <strong>{vision.name}</strong> <span className="debug-note">{vision.blurb}</span>
                <br />
                <span className={`page-tone-${grade(ratio).tone}`}>{showRatio(ratio)}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="debug-note">
        Luminance contrast barely moves under these deficiencies; hue does. What this shows is whether colour alone
        tells two things apart (WCAG 1.4.1), which needs another cue: text, an icon, a pattern.
      </p>
    </div>
  )
}

const PALETTE = '#0b1021\n#eaf3ff\n#8fd8ff\n#e512c8\n#767676\n#ffffff'

function Palette({ onPick }: { onPick: (pair: { fg: string; bg: string }) => void }) {
  const [text, setText] = useState(PALETTE)
  const { colours, bad, dropped } = useMemo(() => parsePalette(text, resolveColour), [text])
  return (
    <section className="panel debug-panel debug-wide" aria-labelledby="a11y-palette-title">
      <h2 id="a11y-palette-title" className="page-h3">
        {'// PALETTE'}
      </h2>
      <div className="a11y-palette">
        <div className="a11y-field">
          <label htmlFor="a11y-palette-input">Colours, one per line or comma-separated (up to 24)</label>
          <textarea
            id="a11y-palette-input"
            className="users-input a11y-textarea"
            rows={8}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {bad.length > 0 && <p className="debug-note page-tone-warn">Not colours: {bad.join(', ')}</p>}
          {dropped > 0 && <p className="debug-note">The first 24 are shown; {dropped} more left out.</p>}
        </div>
        {colours.length > 1 && (
          <div className="page-scroll">
            <table className="a11y-matrix">
              <caption className="page-sr">
                Contrast of every text colour (rows) on every background (columns). Pick a cell to check it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="page-sr">Text, then background</span>
                  </th>
                  {keyed(colours, (entry) => entry.text).map(({ key, item }) => (
                    <th key={key} scope="col">
                      <Swatch colour={toHex(item.colour)} />
                      <span>{item.text}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keyed(colours, (entry) => entry.text).map(({ key, item: row }) => (
                  <tr key={key}>
                    <th scope="row">
                      <Swatch colour={toHex(row.colour)} />
                      <span>{row.text}</span>
                    </th>
                    {keyed(colours, (entry) => entry.text).map(({ key: column, item: col }) => {
                      if (col.text === row.text) return <td key={column} className="a11y-matrix-self" />
                      const ratio = contrast(row.colour, col.colour)
                      const level = grade(ratio)
                      const shown = resolvePair(row.colour, col.colour)
                      return (
                        <td key={column}>
                          <button
                            type="button"
                            className={`a11y-cell a11y-cell-${level.tone}`}
                            style={{ color: toHex(shown.fg), backgroundColor: toHex(shown.bg) }}
                            title={`${row.text} on ${col.text}: ${showRatio(ratio)}, ${level.label}`}
                            onClick={() => onPick({ fg: row.text, bg: col.text })}
                          >
                            <span className="a11y-cell-ratio">{(Math.floor(ratio * 10) / 10).toFixed(1)}</span>
                            <span className="a11y-cell-level">{level.label}</span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

/** A run being started: what shows until the service answers (up to 45 s). */
function pending(url: string): PageRun {
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
    full_page: false,
    status: 'running',
    created_at: new Date().toISOString(),
    completed_at: null,
    cost: 1,
    refunded: false,
    balance_after: null,
  }
}

function Audit({ onCheck }: { onCheck: (pair: { fg: string; bg: string }) => void }) {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') ?? '')
  const [balance, setBalance] = useState<number | null>(null)
  const [run, setRun] = useState<PageRun | null>(null)
  const [history, setHistory] = useState<PageRun[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const page = useRef({ cancelled: false })
  const runRequest = useRef(0)
  const historyRequest = useRef(0)

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

  // Only the newest run started or opened may be shown.
  function claim(): { readonly cancelled: boolean } {
    const request = ++runRequest.current
    const gone = page.current
    return {
      get cancelled() {
        return gone.cancelled || request !== runRequest.current
      },
    }
  }

  function failed(error: unknown, otherwise = 'The audit failed. Try again.') {
    if (page.current.cancelled) return
    if (error instanceof AuthError && error.stepUp) {
      const next = window.location.pathname + window.location.search
      window.location.assign(`/login/step-up/?${new URLSearchParams({ next })}`)
      return
    }
    if (error instanceof AuthError && error.reason === 'insufficient_credits') setBalance(0)
    if (error instanceof AuthError && error.reason === 'not_found') remember({ run: null })
    if (error instanceof RunStillGoing) {
      setMessage('Still running. It will appear in your recent audits when it finishes.')
      refreshHistory()
    } else setMessage(error instanceof AuthError ? describe(error) : otherwise)
  }

  async function follow(started: PageRun, signal: { readonly cancelled: boolean }) {
    setRun(started)
    remember({ run: started.id })
    if (started.balance_after !== null) setBalance(started.balance_after)
    const finished = await waitForRun(started, signal)
    if (signal.cancelled) return
    setRun(finished)
    if (finished.balance_after !== null) setBalance(finished.balance_after)
    if (finished.refunded)
      setMessage("The page didn't load for a reason on the other side, so the credit was refunded.")
    refreshHistory()
  }

  async function execute(target: string) {
    setBusy(true)
    setMessage('')
    const previous = run
    const signal = claim()
    setRun(pending(target))
    try {
      const started = await startRun(target, false)
      if (signal.cancelled) return
      await follow(started, signal)
    } catch (error) {
      if (signal.cancelled) return
      setRun((current) => (current?.id === '' ? previous : current))
      failed(error)
    } finally {
      if (!page.current.cancelled) setBusy(false)
    }
  }

  async function open(id: string) {
    setMessage('')
    const signal = claim()
    try {
      const found = await getRun(id)
      if (signal.cancelled) return
      setUrl(found.url)
      await follow(found, signal)
    } catch (error) {
      if (!signal.cancelled) failed(error, "Couldn't open that audit. Pick it again from your recent audits.")
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
    return () => {
      signal.cancelled = true
    }
  }, [refreshHistory])

  function submit(event: FormEvent) {
    event.preventDefault()
    const target = normaliseUrl(url)
    setUrl(target)
    if (target) void execute(target)
  }

  const noCredits = balance === 0
  const result = run?.result
  return (
    <section className="panel debug-panel debug-wide" aria-labelledby="a11y-audit-title">
      <h2 id="a11y-audit-title" className="page-h3">
        {'// PAGE AUDIT'}
      </h2>
      <form className="page-form" onSubmit={submit}>
        <label className="page-sr" htmlFor="a11y-url">
          URL to audit
        </label>
        <input
          id="a11y-url"
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
          {busy ? 'AUDITING…' : 'AUDIT'}
        </button>
      </form>
      <p className="debug-note">
        One page credit (a page recon run: the site sees a visit). Balance: {balance === null ? '—' : balance}
        {noCredits && ' (ask Mike for more)'}
      </p>
      <p className="debug-message" role="status" aria-live="polite">
        {message}
      </p>

      {run && (
        <div className="a11y-run">
          <div className="page-run-head a11y-run-head">
            <h3 className="page-run-title">{run.host}</h3>
            <span className="debug-note page-run-url">{run.url}</span>
            <span className="debug-note">
              {unfinished ? `${run.status} · ${elapsed} s` : run.status}
              {run.refunded && ' · refunded'}
              {run.completed_at && ` · ${when(run.completed_at)}`}
            </span>
            {run.id && !unfinished && (
              <a className="debug-link" href={`/tools/page/?run=${encodeURIComponent(run.id)}`}>
                Everything else in this run →
              </a>
            )}
          </div>
          {unfinished || !result ? (
            <p className="debug-note page-collecting">Loading the page in a headless browser and auditing it…</p>
          ) : !result.ok ? (
            <p className="debug-note page-tone-bad">
              The page didn't load: {result.error?.message ?? 'no reason given'}.
              {run.refunded && ' The credit was refunded.'}
            </p>
          ) : result.accessibility ? (
            <Report audit={result.accessibility} onCheck={onCheck} />
          ) : (
            <p className="debug-note page-tone-warn">
              {result.accessibility === null
                ? `The audit didn't run on this page: ${result.notes.find((note) => note.includes('accessibility')) ?? 'see the run’s notes'}.`
                : 'This run was made before page recon audited accessibility. Audit the page again.'}
            </p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details className="page-raw a11y-history">
          <summary>{`Recent audits and page runs (${history.length})`}</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} aria-current={entry.id === run?.id || undefined}>
                <button type="button" className="debug-inline" onClick={() => void open(entry.id)}>
                  {entry.url}
                </button>
                <span className="debug-note">
                  {' '}
                  {when(entry.created_at)}
                  {entry.status !== 'complete' && ` · ${entry.status}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="debug-note">The same runs as page recon's, kept for about an hour.</p>
        </details>
      )}
    </section>
  )
}

function Report({ audit, onCheck }: { audit: Accessibility; onCheck: (pair: { fg: string; bg: string }) => void }) {
  const sum = auditSummary(audit)
  const level = automatedLevel(audit)
  return (
    <>
      <dl className="a11y-stats">
        <div>
          <dt>Violations</dt>
          <dd className={`page-tone-${sum.violations ? (IMPACT_TONE[sum.worst ?? ''] ?? 'warn') : 'good'}`}>
            {sum.violations} rules · {sum.elements} elements
          </dd>
        </div>
        {(['critical', 'serious', 'moderate', 'minor'] as const).map((impact) => (
          <div key={impact}>
            <dt>{impact}</dt>
            <dd className={audit.counts.by_impact[impact] ? `page-tone-${IMPACT_TONE[impact]}` : undefined}>
              {audit.counts.by_impact[impact] ?? 0}
            </dd>
          </div>
        ))}
        <div>
          <dt>Automated level</dt>
          <dd className={level === 'none' ? 'page-tone-bad' : level === 'AAA' ? 'page-tone-good' : 'page-tone-warn'}>
            {level === 'none' ? 'fails A' : `${level} so far`}
          </dd>
        </div>
        <div>
          <dt>Passed rules</dt>
          <dd>{audit.passes}</dd>
        </div>
        <div>
          <dt>Needs review</dt>
          <dd className={sum.review ? 'page-tone-info' : undefined}>{sum.review}</dd>
        </div>
      </dl>
      <p className="debug-note">
        {audit.engine.name} {audit.engine.version}, {audit.standard} A, AA and AAA rules and best practices, run in the
        top frame (cross-origin frames aren't entered). "Automated level" is the most the page could still claim from
        these rules alone.
      </p>

      {audit.contrast.length > 0 && (
        <div className="a11y-pairs">
          <h4 className="page-h3">{`// FAILING COLOUR PAIRS (${audit.contrast.length})`}</h4>
          <ul>
            {keyed(audit.contrast, (entry) => `${entry.rule}:${entry.fg}:${entry.bg}:${entry.expected}`).map(
              ({ key, item }) => {
                const pair = pairOf(item)
                const fix = pair && item.expected ? suggest(pair.fg, pair.bg, item.expected)[0] : undefined
                return (
                  <li key={key}>
                    <span
                      className="a11y-vision-sample"
                      style={pair ? { color: toHex(pair.fg), backgroundColor: toHex(pair.bg) } : undefined}
                    >
                      Aa
                    </span>
                    <span className="a11y-pair-text">
                      <strong>
                        {item.fg} on {item.bg}
                      </strong>{' '}
                      <span className="page-tone-bad">{item.ratio ?? '?'}:1</span>
                      <span className="debug-note">
                        {' '}
                        needs {item.expected}:1 ({item.rule === 'color-contrast-enhanced' ? '1.4.6 AAA' : '1.4.3 AA'}
                        ), {item.count} element{item.count === 1 ? '' : 's'}
                        {item.font_size && `, ${item.font_size} ${item.font_weight ?? ''}`}
                      </span>
                      {item.example && <span className="a11y-example">“{item.example}”</span>}
                      {fix && <span className="debug-note"> Nearest pass: text {fix.colour}.</span>}
                    </span>
                    {item.fg && item.bg && (
                      <button
                        type="button"
                        className="debug-inline"
                        onClick={() => onCheck({ fg: item.fg ?? '', bg: item.bg ?? '' })}
                      >
                        Check
                      </button>
                    )}
                  </li>
                )
              },
            )}
          </ul>
        </div>
      )}

      <Rules title="VIOLATIONS" rules={audit.violations} open />
      <Rules title="NEEDS REVIEW" rules={audit.incomplete} />
    </>
  )
}

function Rules({ title, rules, open = false }: { title: string; rules: AxeRule[]; open?: boolean }) {
  if (!rules.length) return null
  return (
    <div className="a11y-rules">
      <h4 className="page-h3">{`// ${title} (${rules.length})`}</h4>
      {rules.map((rule) => (
        <details key={rule.id} className="page-raw a11y-rule" open={open && rules.length <= 6}>
          <summary>
            <span className={`a11y-impact page-tone-${IMPACT_TONE[rule.impact ?? ''] ?? 'info'}`}>
              {rule.impact ?? 'n/a'}
            </span>{' '}
            {rule.help ?? rule.id} <span className="debug-note">· {criteria(rule)}</span>
            <span className="debug-note">
              {' '}
              · {rule.nodes_total} element{rule.nodes_total === 1 ? '' : 's'}
            </span>
          </summary>
          {rule.description && <p className="debug-note">{rule.description}</p>}
          {rule.help_url && (
            <p className="debug-note">
              <a className="debug-link" href={rule.help_url} target="_blank" rel="noopener noreferrer">
                How to fix {rule.id} (Deque) ↗
              </a>
            </p>
          )}
          <ol className="a11y-nodes">
            {keyed(rule.nodes, (node) => `${node.target}`).map(({ key, item: node }) => (
              <li key={key}>
                <code className="debug-mono">{node.target}</code>
                {node.html && <pre className="debug-raw a11y-html">{node.html}</pre>}
                {node.summary && <p className="a11y-summary">{node.summary}</p>}
              </li>
            ))}
          </ol>
          {rule.nodes_total > rule.nodes.length && (
            <p className="debug-note">
              {rule.nodes_total - rule.nodes.length} more not listed (the first {rule.nodes.length} are kept).
            </p>
          )}
        </details>
      ))}
    </div>
  )
}
