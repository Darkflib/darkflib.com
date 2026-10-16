import { useEffect, useState } from 'react'
import { AccessScene, PasskeyIcon } from './AccessScene'
import {
  AuthError,
  getSession,
  isCancel,
  nextPath,
  passkeysSupported,
  type Registration,
  registerPasskey,
  type SessionState,
  stepUp,
  TIER_REASONS,
  type Tier,
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
  // What the last attempt asked for, and what came of it.
  const [hardware, setHardware] = useState(false)
  const [result, setResult] = useState<Registration | null>(null)
  // The level the service asked to see again before adding a key (HIGH when the account already holds a usable one).
  const [stepUpTier, setStepUpTier] = useState<Tier>('STANDARD')
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

  async function create(asHardware: boolean) {
    setBusy(true)
    setMessage('')
    setHardware(asHardware)
    try {
      setResult(await registerPasskey(nickname.trim() || null, asHardware))
      setStage('done')
    } catch (error) {
      if (error instanceof AuthError && error.stepUp) {
        // The account already has a key and none was used recently. WebAuthn wants a fresh click per prompt, so ask
        // for one rather than chaining a second prompt onto this one.
        setStepUpTier(error.stepUp.tier)
        setStage('step-up')
      } else if (error instanceof AuthError && error.reason === 'mds_stale') {
        setMessage('Hardware key checks are unavailable right now (the FIDO metadata is out of date). Try again later.')
      } else if (!isCancel(error)) {
        setMessage('The key could not be saved. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setMessage('')
    try {
      await stepUp(stepUpTier)
      setStage('ready')
      setMessage(`Confirmed. Now add the new ${hardware ? 'hardware key' : 'passkey'}.`)
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
    const high = result?.tier === 'HIGH'
    const downgraded = hardware && !high
    const until = result?.credential.cooldown_until
    return (
      <AccessScene headingId="enrol-heading" step="02 / PASSKEY" status="ENROLLED">
        <h2 id="enrol-heading" className="access-heading">
          {high ? 'Hardware key added' : 'Passkey added'}
          <span>.</span>
        </h2>
        <p className="access-intro">
          {high
            ? `It counts as a hardware key (HIGH)${until ? ` once its first-day cooldown ends, at ${new Date(until).toLocaleString()}` : ''}. Until then it works as an ordinary passkey.`
            : 'Next time, USE A PASSKEY signs you straight in.'}
        </p>
        {downgraded && (
          <p className="access-feedback">
            Saved as an ordinary passkey, not a hardware key.{' '}
            {(result?.tier_reason && TIER_REASONS[result.tier_reason]) ??
              'It did not meet the requirements for a hardware key.'}
          </p>
        )}
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
          <p className="access-intro">
            First, confirm it is you with {stepUpTier === 'HIGH' ? 'your hardware key' : 'a passkey you already have'}.
          </p>
          <button className="access-submit" type="button" onClick={confirm} disabled={busy}>
            <span className="access-provider-label">
              <PasskeyIcon />
              {stepUpTier === 'HIGH' ? 'CONFIRM WITH A HARDWARE KEY' : 'CONFIRM WITH A PASSKEY'}
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create(false)
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
          <button
            className="access-secondary access-hardware"
            type="button"
            onClick={() => create(true)}
            disabled={busy || session === undefined}
          >
            <span className="access-provider-label">
              <PasskeyIcon />
              ADD A HARDWARE KEY
            </span>
            <span aria-hidden="true">↗</span>
          </button>
          <p className="access-note">
            A hardware key (a YubiKey or other FIDO security key) can unlock tools that need the highest level. Synced
            passkeys from a password manager count as ordinary passkeys.
          </p>
        </form>
      )}
      <p className="access-feedback" role="status" aria-live="polite">
        {message}
      </p>
      {skip}
    </AccessScene>
  )
}
