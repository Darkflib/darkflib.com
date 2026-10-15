import { useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import {
  AuthError,
  getSession,
  isCancel,
  nextPath,
  passkeysSupported,
  registerPasskey,
  type SessionState,
  stepUp,
} from './auth'

type Stage = 'ready' | 'step-up' | 'done'

/**
 * /login/enrol/: add a passkey to the signed-in account. The service sends a new account here after its first
 * GitHub or Google sign-in; anything that spends credits asks for a passkey, so this is skippable but encouraged.
 */
export function EnrolPage() {
  const [next] = useState(() => nextPath(window.location.search))
  const [session, setSession] = useState<SessionState | null | undefined>(undefined)
  const [stage, setStage] = useState<Stage>('ready')
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSession().then((state) => {
      if (cancelled) return
      if (state === null) {
        const here = window.location.pathname + window.location.search
        window.location.replace(`/login/?${new URLSearchParams({ next: here })}`)
        return
      }
      setSession(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function create() {
    setBusy(true)
    setMessage('')
    try {
      await registerPasskey(nickname.trim() || null)
      setStage('done')
    } catch (error) {
      if (error instanceof AuthError && error.stepUp) {
        // The account already has a passkey and none was used recently. WebAuthn wants a fresh click per prompt,
        // so ask for one rather than chaining a second prompt onto this one.
        setStage('step-up')
      } else if (error instanceof AuthError && error.reason === 'mds_stale') {
        setMessage('Hardware key checks are unavailable right now. Please try again later.')
      } else if (!isCancel(error)) {
        setMessage('The passkey could not be saved. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setMessage('')
    try {
      await stepUp('STANDARD')
      setStage('ready')
      setMessage('Confirmed. Now create the new passkey.')
    } catch (error) {
      if (!isCancel(error)) setMessage('That passkey was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  const skip = (
    <a className="access-link" href={next}>
      {session?.has_passkey ? 'Back' : 'Skip for now'}
    </a>
  )

  if (stage === 'done') {
    return (
      <AccessScene headingId="enrol-heading" step="02 / PASSKEY" status="ENROLLED">
        <h2 id="enrol-heading" className="access-heading">
          Passkey added<span>.</span>
        </h2>
        <p className="access-intro">Next time, USE A PASSKEY signs you straight in.</p>
        <a className="access-submit" href={next}>
          <span>CONTINUE</span>
          <span aria-hidden="true">↗</span>
        </a>
      </AccessScene>
    )
  }

  return (
    <AccessScene headingId="enrol-heading" step="02 / PASSKEY" status="ENROLMENT">
      <h2 id="enrol-heading" className="access-heading">
        Add a passkey<span>.</span>
      </h2>
      <p className="access-intro">
        {session?.has_passkey
          ? 'You already have a passkey. Add another for a second device, or a hardware key.'
          : 'Anything that spends credits asks for a passkey. It lives on this device or in your password manager, and signs you in without GitHub or Google.'}
      </p>
      {!passkeysSupported() ? (
        <p className="access-feedback">
          This browser cannot create passkeys. Try a current Chrome, Firefox, or Safari.
        </p>
      ) : stage === 'step-up' ? (
        <>
          <p className="access-intro">First, confirm it is you with a passkey you already have.</p>
          <button className="access-submit" type="button" onClick={confirm} disabled={busy}>
            <span className="access-provider-label">
              <PasskeyIcon />
              CONFIRM WITH A PASSKEY
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <label className="access-label" htmlFor="nickname">
            NAME IT <span>OPTIONAL</span>
          </label>
          <input
            id="nickname"
            className="access-input"
            name="nickname"
            maxLength={64}
            autoComplete="off"
            placeholder="e.g. MacBook, YubiKey"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <button className="access-submit" type="submit" disabled={busy || session === undefined}>
            <span className="access-provider-label">
              <PasskeyIcon />
              CREATE PASSKEY
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <p className="access-feedback" role="status" aria-live="polite">
        {message}
      </p>
      {skip}
    </AccessScene>
  )
}
