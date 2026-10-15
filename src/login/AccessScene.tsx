import { type ReactNode, useEffect, useRef } from 'react'
import { SiteShell } from '../components/SiteShell'
import { runGrid } from './grid'
import './Access.css'

interface AccessSceneProps {
  /** Labels the panel: its id goes on the panel's heading. */
  headingId: string
  /** The panel's top bar: what step this is, then a status on the right. */
  step: string
  status: string
  /** The masthead's status line. */
  systemState?: string
  children: ReactNode
}

/** The access pages' layout: the animated grid behind a masthead and one panel, inside the site's usual chrome. */
export function AccessScene({
  headingId,
  step,
  status,
  systemState = 'AUTHENTICATION REQUIRED',
  children,
}: AccessSceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvas.current) return runGrid(canvas.current)
  }, [])

  return (
    <SiteShell page="login">
      <div className="access-scene">
        <div className="access-backdrop" aria-hidden="true">
          <canvas ref={canvas} className="access-grid" />
          <div className="access-streams" />
        </div>
        <div className="access-body">
          <section className="access-masthead" aria-label="Private tools">
            <div className="access-micro">{'DARKFLIB // PRIVATE TOOLS'}</div>
            <h1 className="access-title">
              <span aria-hidden="true">
                ACCESS
                <br />
                <em>_</em>CONTROL
              </span>
              <span className="access-sr">Access control</span>
            </h1>
            <p>
              Tools that spend real money, so they are invite-only. Sign in with GitHub or Google, then add a passkey to
              use them.
            </p>
            <div className="access-stamp">
              <i aria-hidden="true" /> SYSTEM STATE <span>/</span> {systemState}
            </div>
          </section>
          <section className="access-panel" aria-labelledby={headingId}>
            <div className="access-panel-bar">
              <span>{step}</span>
              <span>
                <span className="access-dot" aria-hidden="true">
                  ✦
                </span>{' '}
                {status}
              </span>
            </div>
            {children}
            <div className="access-panel-footer">
              <span>DF :: AUTH</span>
              <span>NO PASSWORDS STORED</span>
            </div>
          </section>
        </div>
      </div>
    </SiteShell>
  )
}

/** The passkey glyph from the prototype: a key whose bow is a person. */
export function PasskeyIcon() {
  return (
    <svg className="access-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M12 15h9m-4 0v3m3-3v2M8 11V7a4 4 0 0 1 8 0v2" />
    </svg>
  )
}
