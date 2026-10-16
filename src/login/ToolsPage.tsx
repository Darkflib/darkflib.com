import { useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import { getSession, getTools, logout, type SessionState, type ToolAccess } from './auth'
import { LEVEL_PROOF, TOOLS, toolName } from './tools'

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
  // What the user can see (GET /auth/tools); null from a service without roles, where every tool is open.
  const [access, setAccess] = useState<ToolAccess[] | null | undefined>(undefined)
  const [accessFailed, setAccessFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSession().then((state) => !cancelled && setSession(state))
    getTools().then(
      (result) => !cancelled && setAccess(result?.tools ?? null),
      // Not the same as having no tools: say the list couldn't be loaded.
      () => !cancelled && setAccessFailed(true),
    )
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
          {session && access !== undefined && (
            <ul className="access-tools">
              {(access ?? TOOLS.map((tool) => ({ slug: tool.slug, active: true, step_up: null }))).map((tool) => {
                const blurb = TOOLS.find((entry) => entry.slug === tool.slug)?.blurb
                const href = `/tools/${tool.slug}/`
                return (
                  <li key={tool.slug}>
                    <a
                      className="access-secondary"
                      href={tool.active ? href : `/login/step-up/?${new URLSearchParams({ next: href })}`}
                    >
                      <span>{toolName(tool.slug)}</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                    {blurb && <p>{blurb}</p>}
                    {tool.step_up && <p className="access-needs">Needs {LEVEL_PROOF[tool.step_up.tier]} first.</p>}
                  </li>
                )
              })}
            </ul>
          )}
          {session?.credits && Object.keys(session.credits.balances).length > 0 && (
            <p className="access-note access-credits">
              Credits:{' '}
              {Object.entries(session.credits.balances)
                .map(([type, balance]) => `${type} ${balance}`)
                .join(' · ')}
            </p>
          )}
          {session && accessFailed && (
            <p className="access-feedback">Couldn't load your tools. Refresh to try again.</p>
          )}
          {session && access?.length === 0 && <p className="access-intro">No tools are open to your account yet.</p>}
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
