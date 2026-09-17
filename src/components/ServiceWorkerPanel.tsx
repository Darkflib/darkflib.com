import {
  canUpgrade,
  type ServiceWorkerSnapshot,
  upgradeWaitingWorker,
  useServiceWorker,
  type WaitingWorker,
} from '../telemetry/serviceWorker'
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

const TAKES_OVER_LATER = 'It takes over once every darkflib.com tab has closed.'

function upgradeHint(waiting: WaitingWorker): string {
  if (waiting.upgradeRequested) return 'Waiting for the update to activate…'
  if (waiting.unreachable) return `The waiting worker did not answer. ${TAKES_OVER_LATER}`
  if (waiting.capabilities === null) return 'Checking what the waiting worker supports…'
  if (!waiting.capabilities['skip-waiting']) return `This update cannot be activated from the page. ${TAKES_OVER_LATER}`
  return 'Activate the waiting worker now. Every open darkflib.com tab switches to it.'
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
                  ? `Outdated worker: this page needs ${worker.missingCapabilities.join(', ')}. It updates once every darkflib.com tab has closed, or when you upgrade to a waiting update.`
                  : `Capabilities: ${Object.entries(worker.controllerCapabilities)
                      .map(([name, version]) => `${name} v${version}`)
                      .join(', ')}`
            }
          >
            {worker.controllerVersion ?? '—'}
            {worker.missingCapabilities.length ? ' · OUTDATED' : ''}
          </dd>
        </div>
        {worker.waiting && (
          <div>
            <dt>UPDATE</dt>
            <dd className="worker-update" title={upgradeHint(worker.waiting)}>
              <span data-testid="sw-waiting-version">
                {worker.waiting.version ?? (worker.waiting.unreachable ? 'UNREACHABLE' : '…')}
              </span>
              <button
                type="button"
                className="worker-upgrade"
                disabled={!canUpgrade(worker)}
                aria-busy={worker.waiting.upgradeRequested}
                onClick={upgradeWaitingWorker}
              >
                {worker.waiting.upgradeRequested ? 'UPGRADING…' : 'UPGRADE'}
              </button>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
