import { useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import { getSession, logout, type SessionState } from './auth'

/** The private tools, each at /tools/<slug>/ behind forward_auth (deploy/Caddyfile). */
const TOOLS = [
  {
    slug: 'debug',
    name: 'SESSION DEBUGGER',
    blurb: 'Your session, what a tool receives from the gate, your passkeys, and step-ups.',
  },
]

const PROVIDER_NAMES: Record<SessionState['login_method'], string> = {
  github: 'GitHub',
  google: 'Google',
  passkey: 'a passkey',
}

/**
 * /tools/: where signing in lands. Caddy only serves it to a visitor wwff-auth has already let through, so the
 * session check here is for the page's content, not for access.
 */
export function ToolsPage() {
  const [session, setSession] = useState<SessionState | null | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSession().then((state) => !cancelled && setSession(state))
    return () => {
      cancelled = true
    }
  }, [])

  async function signOut() {
    setBusy(true)
    setMessage('')
    try {
      await logout()
      window.location.assign('/')
    } catch {
      setMessage('Sign-out did not complete, so you are still signed in. Please try again.')
      setBusy(false)
    }
  }

  return (
    <AccessScene
      headingId="tools-heading"
      step="03 / TOOLS"
      status={session ? 'SESSION ACTIVE' : 'NO SESSION'}
      systemState={session ? 'ACCESS GRANTED' : 'AUTHENTICATION REQUIRED'}
    >
      <h2 id="tools-heading" className="access-heading">
        Tools<span>.</span>
      </h2>
      {session === null ? (
        <>
          <p className="access-intro">You are not signed in.</p>
          <a className="access-submit" href="/login/?next=/tools/">
            <span>SIGN IN</span>
            <span aria-hidden="true">↗</span>
          </a>
        </>
      ) : (
        <>
          <p className="access-intro">
            {session
              ? `Signed in as ${session.user.display_name ?? session.identities[0]?.label ?? 'you'}, with ${PROVIDER_NAMES[session.login_method]}.`
              : 'Checking your session…'}
          </p>
          {session && (
            <ul className="access-tools">
              {TOOLS.map((tool) => (
                <li key={tool.slug}>
                  <a className="access-secondary" href={`/tools/${tool.slug}/`}>
                    <span>{tool.name}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                  <p>{tool.blurb}</p>
                </li>
              ))}
            </ul>
          )}
          {session && !session.has_passkey && (
            <a className="access-secondary" href="/login/enrol/?next=/tools/">
              <span className="access-provider-label">
                <PasskeyIcon />
                ADD A PASSKEY
              </span>
              <span aria-hidden="true">↗</span>
            </a>
          )}
          <button className="access-link" type="button" onClick={signOut} disabled={busy || !session}>
            Sign out
          </button>
        </>
      )}
      <p className="access-feedback" role="status" aria-live="polite">
        {message}
      </p>
    </AccessScene>
  )
}
