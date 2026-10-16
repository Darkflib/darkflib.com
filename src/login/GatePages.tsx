import { useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import {
  AuthError,
  getSession,
  getTools,
  isCancel,
  nextPath,
  passkeysSupported,
  stepUp,
  type ToolAccess,
  toolSlug,
} from './auth'
import { LEVEL_PROOF, toolName } from './tools'

/** "15 minutes", "12 hours": a max_age in words. */
function within(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
  return `${seconds} seconds`
}

/**
 * /login/step-up/?next=/tools/<slug>/: the gate sends a page load here when the user holds a role for the tool but
 * hasn't proven its level recently enough. Asks for that proof, then goes on to the tool.
 */
export function StepUpPage() {
  const [next] = useState(() => nextPath(window.location.search))
  const slug = toolSlug(next)
  const [tool, setTool] = useState<ToolAccess | null | undefined>(undefined)
  const [message, setMessage] = useState('')
  // The account has no key of the level asked for, so offer enrolment.
  const [noKey, setNoKey] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = await getSession()
      if (cancelled) return
      if (session === null) {
        window.location.replace(`/login/?${new URLSearchParams({ next })}`)
        return
      }
      const access = await getTools().catch(() => null)
      if (cancelled) return
      const found = access?.tools.find((entry) => entry.slug === slug)
      if (access && !found) {
        window.location.replace(`/login/denied/?${new URLSearchParams({ next })}`)
        return
      }
      if (!access || found?.active) {
        // Nothing to prove (a service without roles, or a proof made in another tab): go on.
        window.location.replace(next)
        return
      }
      setTool(found ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [next, slug])

  const need = tool?.step_up ?? null

  async function prove() {
    if (!need) return
    setBusy(true)
    setMessage('')
    try {
      await stepUp(need.tier)
      window.location.assign(next)
    } catch (error) {
      if (isCancel(error)) setMessage('')
      else if (error instanceof AuthError && error.reason === 'no_eligible_credential') {
        setMessage(`You have no ${need.tier === 'HIGH' ? 'hardware key' : 'passkey'} enrolled yet.`)
        setNoKey(true)
      } else if (error instanceof AuthError && error.reason === 'credential_in_cooldown')
        setMessage('Your hardware key is still in its first-day cooldown. Try again once it has passed.')
      else if (error instanceof AuthError && error.reason === 'mds_stale')
        setMessage('Hardware key checks are unavailable right now. Try again later.')
      else setMessage('That was not accepted. Please try again.')
      setBusy(false)
    }
  }

  const name = slug ? toolName(slug) : 'This tool'
  return (
    <AccessScene headingId="stepup-heading" step="03 / STEP-UP" status="PROOF REQUIRED">
      <h2 id="stepup-heading" className="access-heading">
        Confirm it's you<span>.</span>
      </h2>
      {tool === undefined || !need ? (
        <p className="access-intro">Checking what {name} needs…</p>
      ) : (
        <>
          <p className="access-intro">
            {name} needs {LEVEL_PROOF[need.tier]} from the last {within(need.max_age)}.
          </p>
          {need.tier === 'FEDERATED' ? (
            <a className="access-submit" href={`/login/?${new URLSearchParams({ next })}`}>
              <span>SIGN IN AGAIN</span>
              <span aria-hidden="true">↗</span>
            </a>
          ) : passkeysSupported() ? (
            <button className="access-submit" type="button" onClick={prove} disabled={busy}>
              <span className="access-provider-label">
                <PasskeyIcon />
                {need.tier === 'HIGH' ? 'USE YOUR HARDWARE KEY' : 'USE A PASSKEY'}
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <p className="access-feedback">This browser cannot use passkeys.</p>
          )}
          {noKey && (
            <a className="access-secondary access-hardware" href={`/login/enrol/?${new URLSearchParams({ next })}`}>
              <span>ADD ONE</span>
              <span aria-hidden="true">↗</span>
            </a>
          )}
        </>
      )}
      <p className="access-feedback" role="status" aria-live="polite">
        {message}
      </p>
      <a className="access-link" href="/tools/">
        All tools
      </a>
    </AccessScene>
  )
}

/** /login/denied/?next=/tools/<slug>/: the gate sends a page load here when the user holds no role for the tool. */
export function DeniedPage() {
  const [next] = useState(() => nextPath(window.location.search))
  const slug = toolSlug(next)
  return (
    <AccessScene headingId="denied-heading" step="03 / ACCESS" status="NOT PERMITTED" systemState="ACCESS DENIED">
      <h2 id="denied-heading" className="access-heading">
        Not for you<span>.</span>
      </h2>
      <p className="access-intro">
        {slug ? `Your account has no role that opens ${toolName(slug)}.` : 'Your account has no role that opens that.'}{' '}
        If you think it should, ask Mike.
      </p>
      <a className="access-submit" href="/tools/">
        <span>ALL TOOLS</span>
        <span aria-hidden="true">↗</span>
      </a>
    </AccessScene>
  )
}
