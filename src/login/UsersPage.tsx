import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { SiteShell } from '../components/SiteShell'
import {
  type AdminUser,
  type AdminUserSummary,
  AuthError,
  adjustCredits,
  getAdminUser,
  isCancel,
  passkeysSupported,
  searchUsers,
  setUserRole,
  stepUp,
  type Tier,
} from './auth'
import './Debug.css'
import './Users.css'

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

/** The user id in ?user=, so a user's details can be linked to. */
const userFromUrl = () => new URLSearchParams(window.location.search).get('user')

/**
 * /tools/users/: the user-admin tool, gated to the `admin` role (wwff-auth's access file). Search users, set the roles
 * the access file marks web_grantable (never `admin`, which is granted only from the command line), and add or remove
 * credits. Every call needs `admin` active, so once it lapses the service asks for a step-up: the page asks for it on
 * a fresh click and then repeats what was being done.
 */
export function UsersPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AdminUserSummary[] | null>(null)
  // The query the shown results (and their `next` cursor) belong to, which the search box may since have left behind.
  const [searched, setSearched] = useState('')
  const [next, setNext] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(userFromUrl)
  // The selection as of now, for discarding a user's details that arrive after another was chosen.
  const selectedRef = useRef(selected)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // A step-up the service asked for, and the call to repeat once it's done: only the call that was refused, never one
  // that had already succeeded (a credit change is not idempotent).
  const [pending, setPending] = useState<{
    tier: Tier
    action: () => Promise<void>
    after?: () => Promise<void>
  } | null>(null)

  /**
   * Runs one admin call. A step-up 401 parks it until the user confirms; anything else becomes the message. `after`
   * (a refresh, a message) runs once the call has succeeded, outside it: if `after` is refused in turn, only `after` is
   * parked. Resolves to whether the call itself succeeded.
   */
  const run = useCallback(async (action: () => Promise<void>, after?: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      if (error instanceof AuthError && error.stepUp) {
        setPending({ tier: error.stepUp.tier, action, after })
      } else if (error instanceof AuthError) {
        setMessage(describe(error))
      } else {
        setMessage(`Failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return false
    } finally {
      setBusy(false)
    }
    await after?.()
    return true
  }, [])

  const search = useCallback(
    (q: string, cursor: string | null = null) =>
      run(async () => {
        const page = await searchUsers(q, cursor)
        setSearched(q)
        setResults((current) => (cursor && current ? [...current, ...page.users] : page.users))
        setNext(page.next)
      }),
    [run],
  )

  const load = useCallback(
    (id: string) =>
      run(async () => {
        const details = await getAdminUser(id)
        // Another user may have been chosen while this was in flight: never show (or act on) a stale one.
        if (selectedRef.current === id) setUser(details)
      }),
    [run],
  )

  useEffect(() => {
    search('')
  }, [search])

  useEffect(() => {
    selectedRef.current = selected
    if (!selected) return
    // No controls for the previous user while the next one loads.
    setUser((current) => (current?.id === selected ? current : null))
    const url = new URL(window.location.href)
    url.searchParams.set('user', selected)
    window.history.replaceState(null, '', url)
    load(selected)
  }, [selected, load])

  async function confirm() {
    if (!pending) return
    const { tier, action, after } = pending
    setBusy(true)
    setMessage('')
    try {
      await stepUp(tier)
      setPending(null)
    } catch (error) {
      setBusy(false)
      if (!isCancel(error)) setMessage(error instanceof AuthError ? describe(error) : 'That was not accepted.')
      return
    }
    await run(action, after)
  }

  function toggleRole(role: string, held: boolean) {
    if (!user) return
    const id = user.id
    run(
      () => setUserRole(id, role, held),
      async () => {
        const done = `${held ? 'Granted' : 'Revoked'} ${role}.`
        if (await load(id)) setMessage(done)
        else setMessage((refused) => `${done} ${refused || 'Refreshing the details failed.'}`)
      },
    )
  }

  function submitCredits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const form = new FormData(event.currentTarget)
    const type = String(form.get('type'))
    const amount = Number(form.get('amount'))
    const note = String(form.get('note')).trim()
    const target = event.currentTarget
    const id = user.id
    // One ref per submission, kept by the retry after a step-up: the service applies a ref once.
    const ref = crypto.randomUUID()
    let balance = 0
    run(
      async () => {
        balance = (await adjustCredits(id, type, amount, note, ref)).balance
      },
      // Applied: clear the form at once, so a failed refresh can't invite applying it again.
      async () => {
        target.reset()
        const done = `${type}: ${amount > 0 ? '+' : ''}${amount}, balance now ${balance}.`
        if (await load(id)) setMessage(done)
        else setMessage((refused) => `${done} ${refused || 'Refreshing the details failed.'}`)
      },
    )
  }

  const creditTypes = user ? Object.keys(user.credits.balances) : []

  return (
    <SiteShell page="login">
      <section className="debug-intro" aria-labelledby="users-title">
        <div className="debug-kicker">{'// TOOLS / USER_ADMIN'}</div>
        <h1 id="users-title">USERS</h1>
        <p>
          Find a user, set the roles that can be granted from here, and add or remove credits. Admin is granted only
          from the command line on the server. Every change is audited.
        </p>
        <div className="debug-actions">
          <a className="button-secondary" href="/tools/">
            ALL TOOLS
          </a>
        </div>
      </section>

      {pending && (
        <section className="panel debug-panel users-stepup" aria-labelledby="users-stepup">
          <h2 id="users-stepup">{'// CONFIRM IT’S YOU'}</h2>
          <p className="debug-note">
            Admin actions need {pending.tier === 'HIGH' ? 'your hardware key' : 'a passkey'} proven recently. Confirm,
            and the last action runs again.
          </p>
          <div className="debug-actions">
            <button className="button-primary" type="button" onClick={confirm} disabled={busy || !passkeysSupported()}>
              {pending.tier === 'HIGH' ? 'USE YOUR HARDWARE KEY' : 'USE A PASSKEY'}
            </button>
            <button className="button-secondary" type="button" onClick={() => setPending(null)} disabled={busy}>
              CANCEL
            </button>
          </div>
        </section>
      )}

      <p className="debug-message users-message" role="status" aria-live="polite">
        {message}
      </p>

      <div className="users-grid">
        <section className="panel debug-panel" aria-labelledby="users-search">
          <h2 id="users-search">{'// SEARCH'}</h2>
          <form
            className="users-search"
            onSubmit={(event) => {
              event.preventDefault()
              search(query.trim())
            }}
          >
            <label className="users-sr" htmlFor="users-q">
              Search users
            </label>
            <input
              id="users-q"
              className="users-input"
              type="search"
              placeholder="email, name, GitHub or Google login, or id"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="button-secondary" type="submit" disabled={busy}>
              SEARCH
            </button>
          </form>
          {results === null ? (
            <p className="debug-note">Loading…</p>
          ) : results.length === 0 ? (
            <p className="debug-note">No users match.</p>
          ) : (
            <ul className="users-results">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    className={result.id === selected ? 'users-result selected' : 'users-result'}
                    aria-current={result.id === selected ? 'true' : undefined}
                    onClick={() => setSelected(result.id)}
                  >
                    <strong>{result.display_name ?? result.email ?? result.id}</strong>
                    <span>
                      {result.identities.map((identity) => `${identity.provider}:${identity.label}`).join(' · ') ||
                        'no linked accounts'}
                    </span>
                    <span>{result.roles.join(', ') || 'no roles'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {next && (
            <button className="debug-link users-more" type="button" onClick={() => search(searched, next)}>
              More
            </button>
          )}
        </section>

        <section className="panel debug-panel" aria-labelledby="users-detail">
          <h2 id="users-detail">{'// USER'}</h2>
          {!user ? (
            <p className="debug-note">{selected ? 'Loading…' : 'Choose a user.'}</p>
          ) : (
            <>
              <dl className="debug-facts">
                <dt>Name</dt>
                <dd>{user.display_name ?? '—'}</dd>
                <dt>Email</dt>
                <dd>{user.email ?? '—'}</dd>
                <dt>User id</dt>
                <dd className="debug-mono">{user.id}</dd>
                <dt>Created</dt>
                <dd>{time(user.created_at)}</dd>
                <dt>Last seen</dt>
                <dd>{time(user.last_seen_at)}</dd>
                <dt>Accounts</dt>
                <dd>
                  {user.identities.map((identity) => `${identity.provider}: ${identity.label}`).join(', ') || 'none'}
                </dd>
                <dt>Passkeys</dt>
                <dd>
                  {user.passkeys.length === 0
                    ? 'none'
                    : user.passkeys
                        .map((key) => `${key.nickname} (${key.tier}${key.synced ? ', synced' : ''})`)
                        .join(', ')}
                </dd>
              </dl>

              <h3 className="users-h3">Roles</h3>
              <ul className="users-roles">
                {user.roles.web_grantable.map((role) => {
                  const held = user.roles.held.includes(role)
                  return (
                    <li key={role}>
                      <label>
                        <input
                          type="checkbox"
                          checked={held}
                          disabled={busy}
                          onChange={(event) => toggleRole(role, event.target.checked)}
                        />{' '}
                        {role}
                      </label>
                    </li>
                  )
                })}
                {user.roles.held
                  .filter((role) => !user.roles.web_grantable.includes(role))
                  .map((role) => (
                    <li key={role} className="users-fixed">
                      <input type="checkbox" checked disabled aria-label={`${role} (command line only)`} /> {role}{' '}
                      <span className="debug-note">granted from the command line</span>
                    </li>
                  ))}
              </ul>

              <h3 className="users-h3">Credits</h3>
              {creditTypes.length === 0 ? (
                <p className="debug-note">No credit types are defined in the access file.</p>
              ) : (
                <>
                  <dl className="debug-facts">
                    {creditTypes.map((type) => (
                      <div key={type} className="users-balance">
                        <dt>{type}</dt>
                        <dd>{user.credits.balances[type]}</dd>
                      </div>
                    ))}
                  </dl>
                  <form className="users-credits" onSubmit={submitCredits}>
                    <label>
                      Type{' '}
                      <select name="type" className="users-input" required>
                        {creditTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount{' '}
                      <input
                        name="amount"
                        className="users-input"
                        type="number"
                        step={1}
                        min={-100000}
                        max={100000}
                        required
                        placeholder="+5 or -2"
                      />
                    </label>
                    <label className="users-note">
                      Note{' '}
                      <input
                        name="note"
                        className="users-input"
                        required
                        minLength={1}
                        maxLength={200}
                        placeholder="why"
                      />
                    </label>
                    <button className="button-primary" type="submit" disabled={busy}>
                      APPLY
                    </button>
                  </form>
                </>
              )}
              {user.credits.recent.length > 0 && (
                <table className="debug-table">
                  <caption>Recent credit changes</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Type</th>
                      <th scope="col">Change</th>
                      <th scope="col">Balance</th>
                      <th scope="col">By</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.credits.recent.map((entry) => (
                      <tr key={entry.id}>
                        <td>{time(entry.created_at)}</td>
                        <td>{entry.type}</td>
                        <td className={entry.delta < 0 ? 'debug-fail' : 'debug-pass'}>
                          {entry.delta > 0 ? '+' : ''}
                          {entry.delta} {entry.kind}
                        </td>
                        <td>{entry.balance_after}</td>
                        <td className="debug-mono">{entry.actor}</td>
                        <td>{entry.note ?? entry.ref ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
    </SiteShell>
  )
}

/** The service's refusal reasons (docs/contract.md, Administration), in words. */
function describe(error: AuthError): string {
  switch (error.reason) {
    case 'admin_required':
      return 'Your account has no active admin role.'
    case 'role_not_web_grantable':
      return 'That role can only be granted from the command line.'
    case 'insufficient_credits':
      return 'That would take the balance below zero.'
    case 'unknown_credit_type':
      return 'That credit type is not defined.'
    case 'not_found':
      return 'No such user.'
    default:
      return `Refused: ${error.reason ?? `HTTP ${error.status}`}.`
  }
}
