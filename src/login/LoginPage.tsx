import { type ReactNode, useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import {
  acceptInvite,
  getSession,
  isCancel,
  loginWithPasskey,
  logout,
  nextPath,
  type Provider,
  passkeysSupported,
  type SessionState,
  startUrl,
} from './auth'

/** What the service's callbacks put in `?error=` (docs/contract.md, federated sign-in). */
const CALLBACK_ERRORS: Record<string, string> = {
  denied: 'That account cannot sign in here. Access is by invite only.',
  cancelled: 'Sign-in was cancelled at the provider.',
  expired: 'That sign-in attempt expired or came from another browser. Please start again.',
  unavailable: 'The provider could not be reached. Please try again shortly.',
  step_up: 'Linking another account needs a fresh passkey first.',
}

const PROVIDERS: { id: Provider; label: string; icon: ReactNode }[] = [
  {
    id: 'github',
    label: 'CONTINUE WITH GITHUB',
    icon: (
      <svg className="access-icon access-icon-fill" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
      </svg>
    ),
  },
  {
    id: 'google',
    label: 'CONTINUE WITH GOOGLE',
    icon: (
      <svg className="access-icon access-icon-fill" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.35ZM12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.75-5.59-4.12H3.07v2.6A10 10 0 0 0 12 22Zm-5.59-8.09a6 6 0 0 1 0-3.82v-2.6H3.07a10 10 0 0 0 0 9.02l3.34-2.6ZM12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.6C7.2 7.73 9.4 5.98 12 5.98Z" />
      </svg>
    ),
  },
]

type Invite = 'none' | 'checking' | 'accepted' | 'invalid'

/**
 * The invite in `#invite=<token>`, redeemed once when this module loads. Outside the component, so a remount (or
 * StrictMode's double effect) cannot spend the single-use token twice. The token is removed from the address bar
 * straight away, so it is not left in history or bookmarks.
 */
const inviteResult: Promise<boolean> | null = (() => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('invite')
  if (token === null) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return acceptInvite(token).then(
    () => true,
    () => false,
  )
})()

/** /login/: GitHub or Google to get in, or a passkey for a returning visitor who has one. */
export function LoginPage() {
  const [next] = useState(() => nextPath(window.location.search))
  const [session, setSession] = useState<SessionState | null | undefined>(undefined)
  const [invite, setInvite] = useState<Invite>(inviteResult ? 'checking' : 'none')
  const [message, setMessage] = useState(() => {
    const error = new URLSearchParams(window.location.search).get('error')
    return error ? (CALLBACK_ERRORS[error] ?? 'Sign-in did not complete. Please try again.') : ''
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    inviteResult?.then((accepted) => !cancelled && setInvite(accepted ? 'accepted' : 'invalid'))
    getSession().then((state) => !cancelled && setSession(state))
    return () => {
      cancelled = true
    }
  }, [])

  async function signInWithPasskey() {
    setBusy(true)
    setMessage('')
    try {
      await loginWithPasskey()
      window.location.assign(next)
    } catch (error) {
      setMessage(isCancel(error) ? '' : 'That passkey was not accepted. Use GitHub or Google instead.')
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setMessage('')
    try {
      await logout()
      setSession(null)
    } catch {
      // The session cookie is HttpOnly, so only the service can end it: never show signed out unless it did.
      setMessage('Sign-out did not complete, so you are still signed in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (session) {
    const name = session.user.display_name ?? session.identities[0]?.label ?? 'you'
    return (
      <AccessScene
        headingId="access-heading"
        step="01 / AUTHENTICATION"
        status="SESSION ACTIVE"
        systemState="ACCESS GRANTED"
      >
        <h2 id="access-heading" className="access-heading">
          Signed in<span>.</span>
        </h2>
        <p className="access-intro">As {name}.</p>
        <a className="access-submit" href={next}>
          <span>CONTINUE</span>
          <span aria-hidden="true">↗</span>
        </a>
        {!session.has_passkey && (
          <a className="access-secondary" href={`/login/enrol/?${new URLSearchParams({ next })}`}>
            <span className="access-provider-label">
              <PasskeyIcon />
              ADD A PASSKEY
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
        <button className="access-link" type="button" onClick={signOut} disabled={busy}>
          Sign out
        </button>
        <p className="access-feedback" role="status" aria-live="polite">
          {message}
        </p>
      </AccessScene>
    )
  }

  const intro =
    invite === 'accepted'
      ? 'Invite accepted. Choose the account you will sign in with from now on.'
      : invite === 'invalid'
        ? 'That invite has expired or was already used. Ask for a new one.'
        : 'Sign in with the account you used when you accepted your invite.'

  return (
    <AccessScene headingId="access-heading" step="01 / AUTHENTICATION" status="INVITE ONLY">
      <h2 id="access-heading" className="access-heading">
        Identify yourself<span>.</span>
      </h2>
      <p className="access-intro" aria-live="polite">
        {invite === 'checking' ? 'Checking your invite…' : intro}
      </p>
      <div className="access-providers">
        {PROVIDERS.map((provider) => (
          // Inert until the invite is redeemed: leaving mid-request could cancel it, and the callback would then find
          // no invite and refuse the new account.
          <a
            key={provider.id}
            className={provider.id === 'github' ? 'access-submit' : 'access-secondary'}
            href={invite === 'checking' ? undefined : startUrl(provider.id, next)}
            aria-disabled={invite === 'checking' || undefined}
          >
            <span className="access-provider-label">
              {provider.icon}
              {provider.label}
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
      {invite !== 'accepted' && passkeysSupported() && (
        <>
          <div className="access-divider" aria-hidden="true">
            OR, IF YOU HAVE ONE
          </div>
          <button className="access-passkey" type="button" onClick={signInWithPasskey} disabled={busy}>
            <PasskeyIcon />
            USE A PASSKEY
          </button>
        </>
      )}
      <p className="access-feedback" role="status" aria-live="polite">
        {message}
      </p>
    </AccessScene>
  )
}
