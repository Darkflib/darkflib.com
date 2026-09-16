import { Check, Send, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CONTACT_API, CONTACT_PAGE_URL } from '../content'
import './ContactDialog.css'

type Status = 'idle' | 'submitting' | 'sent' | 'rate-limited' | 'error'

interface Fields {
  name: string
  email: string
  subject: string
  message: string
  /** Honeypot: a real visitor never fills this in. */
  website: string
}

const EMPTY: Fields = { name: '', email: '', subject: '', message: '', website: '' }

// The same rules the API applies, so an obvious mistake is caught before a single-use token is spent.
function validate(fields: Fields): Partial<Record<keyof Fields, string>> {
  const errors: Partial<Record<keyof Fields, string>> = {}
  if (!fields.name.trim()) errors.name = 'Required.'
  if (!fields.email.trim()) errors.email = 'Required.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = 'Not a valid address.'
  if (!fields.subject.trim()) errors.subject = 'Required.'
  if (fields.message.trim().length < 10) errors.message = 'At least 10 characters.'
  return errors
}

export function ContactDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [token, setToken] = useState<string | null>(null)
  const [tokenFailed, setTokenFailed] = useState(false)
  // Signals the API scores for how human the submission looks. Counters, not content.
  const signals = useRef({ keystrokes: 0, focusEvents: 0, pointerMoved: false })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // A form-load token, issued per opening: single-use, bound to this IP and user agent, and valid for 30 minutes.
  useEffect(() => {
    if (!open || token !== null) return
    const controller = new AbortController()
    fetch(`${CONTACT_API}/token`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { token?: string }) => {
        if (typeof body.token === 'string') setToken(body.token)
        else setTokenFailed(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setTokenFailed(true)
      })
    return () => controller.abort()
  }, [open, token])

  useEffect(() => {
    if (!open) return
    const onMove = () => {
      signals.current.pointerMoved = true
    }
    window.addEventListener('mousemove', onMove, { passive: true, once: true })
    window.addEventListener('touchmove', onMove, { passive: true, once: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
    }
  }, [open])

  const set = (field: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [field]: event.target.value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = validate(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setStatus('submitting')
    try {
      const response = await fetch(CONTACT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fields.name.trim(),
          email: fields.email.trim(),
          subject: fields.subject.trim(),
          message: fields.message.trim(),
          website: fields.website,
          token: token ?? '',
          signals: {
            keystrokes: signals.current.keystrokes,
            focus_events: signals.current.focusEvents,
            pointer_moved: signals.current.pointerMoved,
          },
        }),
      })
      if (response.status === 429) {
        setStatus('rate-limited')
        return
      }
      if (!response.ok) {
        setStatus('error')
        return
      }
      setStatus('sent')
      setFields(EMPTY)
      // Tokens are single-use: the next opening needs a fresh one.
      setToken(null)
    } catch {
      setStatus('error')
    }
  }

  const close = () => ref.current?.close()
  const reset = () => {
    setStatus('idle')
    setErrors({})
  }

  const field = (name: 'name' | 'email' | 'subject') => (
    <label className="contact-field" htmlFor={`contact-${name}`}>
      <span>{name.toUpperCase()}</span>
      <input
        id={`contact-${name}`}
        name={name}
        type={name === 'email' ? 'email' : 'text'}
        autoComplete={name === 'email' ? 'email' : name === 'name' ? 'name' : 'off'}
        value={fields[name]}
        onChange={set(name)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `contact-${name}-error` : undefined}
      />
      {errors[name] && (
        <em id={`contact-${name}-error`} className="contact-error">
          {errors[name]}
        </em>
      )}
    </label>
  )

  return (
    <dialog
      ref={ref}
      className="contact-dialog panel"
      aria-labelledby="contact-dialog-title"
      onClose={() => {
        onClose()
        reset()
      }}
      onKeyDown={() => {
        signals.current.keystrokes += 1
      }}
      onFocus={() => {
        signals.current.focusEvents += 1
      }}
    >
      <button type="button" className="modal-close" onClick={close} aria-label="Close contact form">
        <X size={20} />
      </button>
      <div className="contact-head">
        <span>{'// OPEN_CHANNEL'}</span>
        <h2 id="contact-dialog-title">SAY HELLO</h2>
        <p>
          This form posts to the contact API on mikepreston.org, which is rate-limited and spam-gated. No address to
          harvest, and nothing is stored in this browser.
        </p>
      </div>
      {status === 'sent' ? (
        <div className="contact-result" data-testid="contact-sent">
          <p>
            <Check size={16} /> MESSAGE SENT. Reply comes from mikepreston.org.
          </p>
          <button type="button" className="button-secondary" onClick={close}>
            CLOSE
          </button>
        </div>
      ) : (
        <form className="contact-form" onSubmit={submit} noValidate>
          {field('name')}
          {field('email')}
          {field('subject')}
          <label className="contact-field" htmlFor="contact-message">
            <span>MESSAGE</span>
            <textarea
              id="contact-message"
              name="message"
              rows={5}
              value={fields.message}
              onChange={set('message')}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={errors.message ? 'contact-message-error' : undefined}
            />
            {errors.message && (
              <em id="contact-message-error" className="contact-error">
                {errors.message}
              </em>
            )}
          </label>
          {/* Honeypot: off-screen, never announced, never tabbed to. Anything typed here is a bot. */}
          <label className="contact-honeypot" aria-hidden="true" htmlFor="contact-website">
            Website
            <input
              id="contact-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={fields.website}
              onChange={set('website')}
            />
          </label>
          {tokenFailed && (
            <p className="contact-notice" role="alert" data-testid="contact-token-failed">
              The contact API is not answering. Try <a href={CONTACT_PAGE_URL}>the form on mikepreston.org</a> instead.
            </p>
          )}
          {status === 'rate-limited' && (
            <p className="contact-notice" role="alert" data-testid="contact-rate-limited">
              Rate limit reached: too many messages from this address. Try again later.
            </p>
          )}
          {status === 'error' && (
            <p className="contact-notice" role="alert" data-testid="contact-error">
              That did not send. Try again, or use <a href={CONTACT_PAGE_URL}>the form on mikepreston.org</a>.
            </p>
          )}
          <div className="contact-actions">
            <button type="submit" className="button-primary" disabled={status === 'submitting' || tokenFailed}>
              {status === 'submitting' ? 'SENDING…' : 'SEND'} <Send size={16} />
            </button>
            <button type="button" className="modal-return" onClick={close}>
              CANCEL
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
