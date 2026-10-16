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
import './Debug.css'
import './Users.css'
import './Domain.css'

type Value = string | number | boolean | null | undefined

/** Reads a dotted path out of a collector's loosely typed payload. */
function at(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in node) return (node as Record<string, unknown>)[key]
    return undefined
  }, data)
}

const list = (value: unknown, pick?: (item: Record<string, unknown>) => Value) =>
  Array.isArray(value) ? value.map((item) => (pick ? pick(item as Record<string, unknown>) : item)).filter(Boolean) : []

const date = (value: unknown) => (typeof value === 'string' ? new Date(value).toLocaleDateString() : undefined)

/** The few fields worth reading first for each check; the full result is under it. */
function summary(check: Check, data: Record<string, unknown>): [string, Value][] {
  switch (check) {
    case 'rdap': {
      const registrar =
        (at(data, 'whois43.registrar') as string | undefined) ??
        list(at(data, 'entities'), (entity) =>
          Array.isArray(entity.roles) && entity.roles.includes('registrar') ? (at(entity, 'vcard.fn') as string) : null,
        )[0]
      return [
        ['Source', at(data, 'data_source') as string],
        ['Registrar', registrar as string],
        ['Registered', date(at(data, 'registered_at'))],
        ['Expires', date(at(data, 'expires_at'))],
        ['Age (days)', at(data, 'age_days') as number],
        ['Status', list(at(data, 'status')).join(', ')],
        ['Nameservers', list(at(data, 'nameservers'), (ns) => ns.ldh_name as string).join(', ')],
      ]
    }
    case 'dns':
      return [
        ['NXDOMAIN', at(data, 'nxdomain') as boolean],
        ['Authoritative', list(at(data, 'authoritative_nameservers')).join(', ')],
        ['A', list(at(data, 'forward.a')).join(', ')],
        ['AAAA', list(at(data, 'forward.aaaa')).join(', ')],
        [
          'MX',
          list(at(data, 'forward.mx'), (mx) =>
            `${mx.preference ?? mx.priority ?? ''} ${mx.exchange ?? ''}`.trim(),
          ).join(', '),
        ],
        ['TXT kinds', [...new Set(list(at(data, 'forward.txt_typed'), (txt) => txt.kind as string))].join(', ')],
        [
          'DNSSEC',
          at(data, 'dnssec') ? (at(data, 'dnssec.validated') ? 'validated' : 'present, not validated') : 'none',
        ],
        ['Dual stack', at(data, 'reachability.dual_stack') as boolean],
        [
          'CAA zones',
          list(at(data, 'caa_tree'), (node) => (list(node.records).length ? (node.zone as string) : null)).join(', '),
        ],
        ['Lame delegations', list(at(data, 'lame_delegation')).length],
        // Nameservers the delegation named at internal addresses, which wwff-recon refused to query (domaincheck v0.3).
        [
          'Not queried (internal)',
          list(at(data, 'policy_skips'), (skip) =>
            `${skip.nameserver_name ?? ''} ${skip.nameserver_ip ?? ''}`.trim(),
          ).join(', ') || undefined,
        ],
      ]
    case 'tls':
      return [
        ['Protocol', at(data, 'connection.protocol') as string],
        ['Cipher', at(data, 'connection.cipher_name') as string],
        ['Versions', list(at(data, 'accepted_versions')).join(', ')],
        ['Subject', at(data, 'leaf_certificate.subject.common_name') as string],
        ['Names', list(at(data, 'leaf_certificate.san_dns')).length],
        ['Expires', date(at(data, 'leaf_certificate.not_after'))],
        ['Days left', at(data, 'leaf_certificate.days_until_expiry') as number],
        ['Expired', at(data, 'leaf_certificate.is_expired') as boolean],
        ['Issuer', list(at(data, 'chain'), (cert) => at(cert, 'subject.common_name') as string)[0] as string],
        [
          'SCTs',
          at(data, 'sct_summary')
            ? `${at(data, 'sct_summary.known_logs')} known of ${at(data, 'sct_summary.total')}`
            : undefined,
        ],
      ]
    case 'headers': {
      const security = (at(data, 'security') ?? {}) as Record<string, unknown>
      return [
        ['Status', at(data, 'status_code') as number],
        ['HTTP', at(data, 'http_version') as string],
        ['Server', at(data, 'server') as string],
        ['Redirects', list(at(data, 'redirect_chain')).length],
        ['Port 80 → HTTPS', at(data, 'http_upgrade.redirects_to_https') as boolean],
        ['HSTS preload', at(data, 'hsts_preload') as boolean],
        [
          'Security headers',
          Object.entries(security)
            .filter(([, value]) => value != null)
            .map(([name]) => name.replaceAll('_', '-'))
            .join(', ') || 'none',
        ],
        ['Cookies', list(at(data, 'cookies')).length],
      ]
    }
  }
}

const show = (value: Value) =>
  value === undefined || value === null || value === ''
    ? '—'
    : typeof value === 'boolean'
      ? value
        ? 'yes'
        : 'no'
      : String(value)

/** The service's refusals (wwff-recon docs/contract.md), in words. */
function describe(error: AuthError): string {
  switch (error.reason) {
    case 'invalid_domain':
      return "That isn't a domain name this tool can check (no IP addresses, ports, or paths)."
    case 'insufficient_credits':
      return 'You have no domain credits left. Ask Mike for more.'
    case 'rate_limited':
      return 'Too many runs just now. Wait a minute and try again.'
    case 'credits_unavailable':
      return "Credits couldn't be checked just now, so nothing ran and nothing was spent. Try again shortly."
    case 'not_found':
      return 'That run has expired or never existed.'
    default:
      return `Refused: ${error.reason ?? `HTTP ${error.status}`}.`
  }
}

/**
 * /tools/domain/: domain recon (RDAP, DNS, TLS, HTTP headers) through wwff-recon, for the `user` role. Each run spends
 * one `domain` credit, refunded when every check failed for an upstream reason.
 */
export function DomainPage() {
  const [domain, setDomain] = useState('')
  const [checks, setChecks] = useState<Check[]>(CHECKS.map((check) => check.id))
  const [balance, setBalance] = useState<number | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // Set when the page goes away, so no request outlives it and no state is set after it.
  const page = useRef({ cancelled: false })
  // Only the newest history request may replace the list.
  const historyRequest = useRef(0)

  const refreshHistory = useCallback(() => {
    const request = ++historyRequest.current
    listRuns().then(
      (result) => request === historyRequest.current && !page.current.cancelled && setHistory(result.runs),
      () => request === historyRequest.current && !page.current.cancelled && setHistory([]),
    )
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    page.current = signal
    getSession().then((session) => !signal.cancelled && setBalance(session?.credits?.balances.domain ?? null))
    refreshHistory()
    return () => {
      signal.cancelled = true
    }
  }, [refreshHistory])

  /** Shows a run, polling it while it's unfinished; the balance it reports applies at once (a credit is spent). */
  async function follow(started: Run) {
    const signal = page.current
    setRun(started)
    if (started.balance_after !== null) setBalance(started.balance_after)
    const finished = await waitForRun(started, signal)
    if (signal.cancelled) return
    setRun(finished)
    if (finished.balance_after !== null) setBalance(finished.balance_after)
    if (finished.refunded) setMessage('Every check failed upstream, so the credit was refunded.')
    refreshHistory()
  }

  /** The tool's role has lapsed: the step-up page asks for the proof it needs (a passkey, or a fresh sign-in). */
  function stepUpAndReturn() {
    window.location.assign(`/login/step-up/?${new URLSearchParams({ next: '/tools/domain/' })}`)
  }

  function failed(error: unknown) {
    if (page.current.cancelled) return
    if (error instanceof AuthError && error.stepUp) return stepUpAndReturn()
    if (error instanceof AuthError && error.reason === 'insufficient_credits') setBalance(0)
    if (error instanceof RunStillGoing) {
      setMessage('Still running. It will appear in your recent runs when it finishes.')
      refreshHistory()
    } else {
      setMessage(error instanceof AuthError ? describe(error) : 'The run failed. Try again.')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const started = await startRun(domain.trim(), checks)
      if (page.current.cancelled) return
      await follow(started)
    } catch (error) {
      failed(error)
    } finally {
      if (!page.current.cancelled) setBusy(false)
    }
  }

  async function open(id: string) {
    setMessage('')
    try {
      const found = await getRun(id)
      if (page.current.cancelled) return
      // A run still queued or running keeps being polled, like a new one.
      await follow(found)
    } catch (error) {
      failed(error)
    }
  }

  function toggle(check: Check, on: boolean) {
    setChecks((current) => (on ? [...current, check] : current.filter((id) => id !== check)))
  }

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
            className="users-input domain-input"
            placeholder="example.com"
            autoComplete="off"
            spellCheck={false}
            required
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          <button className="button-primary" type="submit" disabled={busy || checks.length === 0 || balance === 0}>
            {busy ? 'RUNNING…' : 'RUN'}
          </button>
          <fieldset className="domain-checks">
            <legend className="domain-sr">Checks</legend>
            {CHECKS.map((check) => (
              <label key={check.id} title={check.blurb}>
                <input
                  type="checkbox"
                  checked={checks.includes(check.id)}
                  onChange={(event) => toggle(check.id, event.target.checked)}
                />{' '}
                {check.name}
              </label>
            ))}
          </fieldset>
        </form>
        <p className="debug-note">
          Costs 1 credit. Balance: {balance === null ? '—' : balance}
          {balance === 0 && ' (ask Mike for more)'}
        </p>
        <p className="debug-message" role="status" aria-live="polite">
          {message}
        </p>
      </section>

      {run && (
        <section className="domain-run" aria-labelledby="domain-run-title">
          <h2 id="domain-run-title" className="domain-run-title">
            {run.domain_unicode}
            {run.domain_a_label !== run.domain_unicode && <span className="debug-note"> ({run.domain_a_label})</span>}
            <span className="debug-note">
              {' '}
              · {run.status}
              {run.refunded && ' · refunded'}
              {run.completed_at && ` · ${new Date(run.completed_at).toLocaleString()}`}
            </span>
          </h2>
          <div className="debug-grid">
            {run.checks.map((check) => (
              <Result key={check} check={check} result={run.results?.[check]} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="panel debug-panel domain-history" aria-labelledby="domain-history">
          <h2 id="domain-history">{'// RECENT RUNS'}</h2>
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="debug-inline" onClick={() => open(entry.id)}>
                  {entry.domain_unicode}
                </button>{' '}
                <span className="debug-note">
                  {new Date(entry.created_at).toLocaleString()} · {entry.status}
                  {entry.refunded && ' · refunded'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SiteShell>
  )
}

function Result({ check, result }: { check: Check; result: CollectionResult | undefined }) {
  const name = CHECKS.find((entry) => entry.id === check)?.name ?? check
  return (
    <section className="panel debug-panel" aria-label={name}>
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
        <p className="debug-note">Waiting…</p>
      ) : result.ok && result.data ? (
        <dl className="debug-facts">
          {summary(check, result.data).map(([label, value]) => (
            <div key={label} className="users-balance">
              <dt>{label}</dt>
              <dd>{show(value)}</dd>
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
        <details className="domain-raw">
          <summary>Full result</summary>
          <pre className="debug-raw">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </section>
  )
}
