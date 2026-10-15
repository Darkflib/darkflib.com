import { useCallback, useEffect, useState } from 'react'
import { SiteShell } from '../components/SiteShell'
import { useNow } from '../hooks/useNow'
import {
  AuthError,
  getSession,
  isCancel,
  listCredentials,
  logout,
  type Passkey,
  passkeysSupported,
  type SessionState,
  stepUp,
  type Tier,
} from './auth'
import './Debug.css'

/** /tools/debug/headers.json: the X-Auth-* headers as Caddy's forward_auth handed them to /tools/* (deploy/Caddyfile). */
type ForwardedHeaders = Record<
  'X-Auth-User' | 'X-Auth-Level' | 'X-Auth-Federated-At' | 'X-Auth-Standard-At' | 'X-Auth-High-At',
  string
>

const TIERS: Tier[] = ['FEDERATED', 'STANDARD', 'HIGH']
const TIER_NAMES: Record<Tier, string> = {
  FEDERATED: 'GitHub or Google',
  STANDARD: 'any passkey',
  HIGH: 'hardware key',
}
const HEADER_FOR: Record<Tier, keyof ForwardedHeaders> = {
  FEDERATED: 'X-Auth-Federated-At',
  STANDARD: 'X-Auth-Standard-At',
  HIGH: 'X-Auth-High-At',
}

/** Requirements a tool might set, checked against the forwarded headers the way contrib/'s helper would. */
const REQUIREMENTS: { tier: Tier; maxAge: number; example: string }[] = [
  { tier: 'FEDERATED', maxAge: 12 * 3600, example: 'open a tool' },
  { tier: 'STANDARD', maxAge: 600, example: 'spend credits' },
  { tier: 'HIGH', maxAge: 300, example: 'admin action' },
]

/** "4m 05s" for a span in seconds; "—" when there is none. */
function span(seconds: number | null): string {
  if (seconds === null) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

async function fetchHeaders(): Promise<ForwardedHeaders | null> {
  const response = await fetch('/tools/debug/headers.json', { credentials: 'same-origin', cache: 'no-store' })
  return response.ok ? ((await response.json()) as ForwardedHeaders) : null
}

/**
 * /tools/debug/: the session debugger, the first (placeholder) tool. Shows the session wwff-auth reports, the
 * headers a tool behind forward_auth receives, the enrolled passkeys, and runs step-ups, so the whole chain can be
 * watched from the browser.
 */
export function DebugPage() {
  const now = useNow(1000)
  const [session, setSession] = useState<SessionState | null | undefined>(undefined)
  const [headers, setHeaders] = useState<ForwardedHeaders | null>(null)
  const [credentials, setCredentials] = useState<Passkey[] | null>(null)
  const [loadedAt, setLoadedAt] = useState(() => Date.now())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [state, forwarded, creds] = await Promise.all([
      getSession(),
      fetchHeaders().catch(() => null),
      listCredentials().catch(() => null),
    ])
    setSession(state)
    setHeaders(forwarded)
    setCredentials(creds)
    setLoadedAt(Date.now())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function runStepUp(tier: Tier) {
    setBusy(true)
    setMessage('')
    try {
      await stepUp(tier)
      setMessage(`Step-up to ${tier} succeeded.`)
      await refresh()
    } catch (error) {
      if (isCancel(error)) setMessage('Step-up cancelled.')
      else if (error instanceof AuthError) setMessage(`Step-up refused: ${error.reason ?? `HTTP ${error.status}`}.`)
      else setMessage(`Step-up failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      await logout()
      window.location.assign('/')
    } catch {
      setMessage('Sign-out did not complete, so you are still signed in.')
      setBusy(false)
    }
  }

  /** Seconds since a forwarded `X-Auth-*-At` header's time, or null when the header is empty. */
  const headerAge = (tier: Tier) => {
    const value = headers?.[HEADER_FOR[tier]]
    return value ? now / 1000 - Number(value) : null
  }
  // assurance ages were computed by the service when the page loaded; keep them ticking from there.
  const sessionAge = (tier: Tier) => {
    const proof = session?.assurance[tier]
    return proof ? proof.age + (now - loadedAt) / 1000 : null
  }

  return (
    <SiteShell page="login">
      <section className="debug-intro" aria-labelledby="debug-title">
        <div className="debug-kicker">{'// TOOLS / SESSION_DEBUG'}</div>
        <h1 id="debug-title">SESSION</h1>
        <p>
          What wwff-auth knows about you, what a tool behind the gate receives, and step-ups to watch the levels move.
          Nothing here changes your account.
        </p>
        <div className="debug-actions">
          <button className="button-secondary" type="button" onClick={refresh} disabled={busy}>
            REFRESH
          </button>
          <a className="button-secondary" href="/tools/">
            ALL TOOLS
          </a>
          <button className="button-secondary" type="button" onClick={signOut} disabled={busy}>
            SIGN OUT
          </button>
        </div>
      </section>

      <div className="debug-grid">
        <section className="panel debug-panel" aria-labelledby="debug-session">
          <h2 id="debug-session">{'// SESSION'}</h2>
          {session === undefined ? (
            <p className="debug-note">Loading…</p>
          ) : session === null ? (
            <p className="debug-note">
              No session. <a href="/login/?next=/tools/debug/">Sign in</a>.
            </p>
          ) : (
            <>
              <dl className="debug-facts">
                <dt>User</dt>
                <dd>{session.user.display_name ?? '—'}</dd>
                <dt>User id</dt>
                <dd className="debug-mono">{session.user.id}</dd>
                <dt>Email</dt>
                <dd>{session.user.email ?? '—'}</dd>
                <dt>Signed in with</dt>
                <dd>{session.login_method}</dd>
                <dt>Identities</dt>
                <dd>{session.identities.map((identity) => `${identity.provider}: ${identity.label}`).join(', ')}</dd>
                <dt>Expires</dt>
                <dd>
                  {time(session.expires_at)} (in {span((Date.parse(session.expires_at) - now) / 1000)})
                </dd>
                <dt>Has passkey</dt>
                <dd>{session.has_passkey ? 'yes' : 'no'}</dd>
              </dl>
              <table className="debug-table">
                <caption>Assurance: when each level was last proven</caption>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Proven by</th>
                    <th scope="col">At</th>
                    <th scope="col">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {TIERS.map((tier) => {
                    const proof = session.assurance[tier]
                    return (
                      <tr key={tier} className={proof ? '' : 'debug-unproven'}>
                        <th scope="row">{tier}</th>
                        <td>{TIER_NAMES[tier]}</td>
                        <td>{proof ? time(proof.auth_at) : 'not proven'}</td>
                        <td>{span(sessionAge(tier))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="panel debug-panel" aria-labelledby="debug-headers">
          <h2 id="debug-headers">{'// WHAT A TOOL RECEIVES'}</h2>
          <p className="debug-note">
            The headers Caddy's forward_auth added to this page's request, after asking /auth/verify. Client copies are
            stripped first, so only wwff-auth can set them.
          </p>
          {headers === null ? (
            <p className="debug-note">Not available (no session, or not behind the gate).</p>
          ) : (
            <>
              <table className="debug-table">
                <tbody>
                  {(Object.keys(headers) as (keyof ForwardedHeaders)[]).map((name) => (
                    <tr key={name} className={headers[name] ? '' : 'debug-unproven'}>
                      <th scope="row" className="debug-mono">
                        {name}
                      </th>
                      <td className="debug-mono">{headers[name] || '(absent)'}</td>
                      <td>
                        {name.endsWith('-At') && headers[name]
                          ? `${time(new Date(Number(headers[name]) * 1000).toISOString())}`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="debug-table">
                <caption>Would a tool's requirement pass right now?</caption>
                <thead>
                  <tr>
                    <th scope="col">Requirement</th>
                    <th scope="col">e.g.</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {REQUIREMENTS.map(({ tier, maxAge, example }) => {
                    const age = headerAge(tier)
                    const pass = age !== null && age <= maxAge
                    return (
                      <tr key={tier}>
                        <th scope="row">
                          {tier} within {span(maxAge)}
                        </th>
                        <td>{example}</td>
                        <td className={pass ? 'debug-pass' : 'debug-fail'}>
                          {pass
                            ? `PASS (${span(maxAge - (age ?? 0))} left)`
                            : age === null
                              ? 'STEP-UP: missing'
                              : 'STEP-UP: stale'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="debug-note">Headers as of the last refresh; the ages keep counting.</p>
            </>
          )}
        </section>

        <section className="panel debug-panel" aria-labelledby="debug-passkeys">
          <h2 id="debug-passkeys">{'// PASSKEYS'}</h2>
          {credentials === null ? (
            <p className="debug-note">Not available.</p>
          ) : credentials.length === 0 ? (
            <p className="debug-note">
              None enrolled. <a href="/login/enrol/?next=/tools/debug/">Add a passkey</a>.
            </p>
          ) : (
            <table className="debug-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Synced</th>
                  <th scope="col">Added</th>
                  <th scope="col">Last used</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.id}>
                    <th scope="row">
                      {credential.nickname}
                      {credential.flagged && <span className="debug-fail"> FLAGGED</span>}
                    </th>
                    <td>
                      {credential.tier}
                      {credential.tier_reason && credential.tier_reason !== 'not_requested' && (
                        <span className="debug-note"> ({credential.tier_reason})</span>
                      )}
                      {credential.in_cooldown && (
                        <span className="debug-note"> cooling down until {time(credential.cooldown_until)}</span>
                      )}
                    </td>
                    <td>{credential.synced ? 'yes' : 'no'}</td>
                    <td>{time(credential.created_at)}</td>
                    <td>{time(credential.last_used_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <a className="debug-link" href="/login/enrol/?next=/tools/debug/">
            Add another passkey
          </a>
        </section>

        <section className="panel debug-panel" aria-labelledby="debug-stepup">
          <h2 id="debug-stepup">{'// STEP-UP'}</h2>
          <p className="debug-note">
            Prove a level again with a passkey, then watch its time reset above. A hardware key step-up needs a HIGH key
            that is out of its cooldown, and a current FIDO metadata snapshot.
          </p>
          {passkeysSupported() ? (
            <div className="debug-actions">
              <button className="button-primary" type="button" onClick={() => runStepUp('STANDARD')} disabled={busy}>
                STEP UP: PASSKEY
              </button>
              <button className="button-secondary" type="button" onClick={() => runStepUp('HIGH')} disabled={busy}>
                STEP UP: HARDWARE KEY
              </button>
            </div>
          ) : (
            <p className="debug-note">This browser cannot use passkeys.</p>
          )}
          <p className="debug-message" role="status" aria-live="polite">
            {message}
          </p>
        </section>

        {session && (
          <section className="panel debug-panel debug-wide" aria-labelledby="debug-raw">
            <h2 id="debug-raw">{'// RAW /auth/session'}</h2>
            <pre className="debug-raw">{JSON.stringify(session, null, 2)}</pre>
          </section>
        )}
      </div>
    </SiteShell>
  )
}
