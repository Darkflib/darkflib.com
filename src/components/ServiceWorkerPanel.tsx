import { type ServiceWorkerSnapshot, useServiceWorker } from '../telemetry/serviceWorker'
import { PanelHeader } from './PanelHeader'
import './ServiceWorkerPanel.css'

function headline(worker: ServiceWorkerSnapshot): { text: string; tone: 'on' | 'off' | 'warn' } {
  if (worker.controlled) return { text: 'CONTROLLING THIS PAGE', tone: 'on' }
  switch (worker.registration) {
    case 'failed':
      return { text: 'REGISTRATION FAILED', tone: 'warn' }
    case 'unsupported':
      return { text: 'NOT SUPPORTED', tone: 'off' }
    case 'disabled':
      return { text: 'DISABLED (?sw=off)', tone: 'off' }
    default:
      return { text: 'INITIALISING', tone: 'off' }
  }
}

function lifecycle({ slots }: ServiceWorkerSnapshot): string {
  const active = slots.active?.toUpperCase() ?? '—'
  if (slots.waiting) return `${active} · UPDATE WAITING`
  if (slots.installing) return `${active} · UPDATE ${slots.installing.toUpperCase()}`
  return active
}

export function ServiceWorkerPanel() {
  const worker = useServiceWorker()
  const status = headline(worker)

  return (
    <section className="panel status-panel" id="systems" aria-labelledby="status-title">
      <PanelHeader id="status-title" title="SERVICE_WORKER" />
      <div className="status-row" data-testid="sw-status">
        <span className={`status-dot ${status.tone}`} />
        {status.text}
      </div>
      <dl className="worker-details">
        <div>
          <dt>REGISTRATION</dt>
          <dd data-testid="sw-registration">{worker.registration.toUpperCase()}</dd>
        </div>
        <div>
          <dt>LIFECYCLE</dt>
          <dd data-testid="sw-lifecycle">{lifecycle(worker)}</dd>
        </div>
        <div>
          <dt>PAGE CONTROL</dt>
          <dd>{worker.controlled ? 'CONTROLLED' : 'NOT YET'}</dd>
        </div>
        <div>
          <dt>WORKER VERSION</dt>
          <dd
            data-testid="sw-version"
            title={
              worker.controllerCapabilities === null
                ? undefined
                : worker.missingCapabilities.length
                  ? `Outdated worker: this page needs ${worker.missingCapabilities.join(', ')}. It updates once every darkflib.com tab has closed.`
                  : `Capabilities: ${Object.entries(worker.controllerCapabilities)
                      .map(([name, version]) => `${name} v${version}`)
                      .join(', ')}`
            }
          >
            {worker.controllerVersion ?? '—'}
            {worker.missingCapabilities.length ? ' · OUTDATED' : ''}
          </dd>
        </div>
      </dl>
    </section>
  )
}
