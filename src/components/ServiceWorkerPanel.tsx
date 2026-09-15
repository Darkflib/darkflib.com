import { ArrowDownRight } from 'lucide-react'
import { useServiceWorker } from '../serviceWorker'
import { PanelHeader } from './PanelHeader'
import './ServiceWorkerPanel.css'

interface ServiceWorkerPanelProps {
  logOpen: boolean
  onToggleLog: () => void
}

export function ServiceWorkerPanel({ logOpen, onToggleLog }: ServiceWorkerPanelProps) {
  const worker = useServiceWorker()

  return (
    <section className="panel status-panel" id="systems" aria-labelledby="status-title">
      <PanelHeader id="status-title" title="SERVICE_WORKER" />
      <div className="status-row">
        <span className={`status-dot ${worker.controlled ? 'on' : ''}`} />
        {worker.controlled
          ? 'CONTROLLING THIS PAGE'
          : worker.registration === 'failed'
            ? 'REGISTRATION FAILED'
            : worker.registration === 'unsupported'
              ? 'NOT SUPPORTED'
              : 'INITIALISING'}
      </div>
      <dl className="worker-details">
        <div>
          <dt>REGISTRATION</dt>
          <dd>{worker.registration.toUpperCase()}</dd>
        </div>
        <div>
          <dt>LIFECYCLE</dt>
          <dd>{worker.lifecycle.toUpperCase()}</dd>
        </div>
        <div>
          <dt>PAGE CONTROL</dt>
          <dd>{worker.controlled ? 'CONTROLLED' : 'NOT YET'}</dd>
        </div>
        <div>
          <dt>SCOPE</dt>
          <dd>{worker.scope}</dd>
        </div>
      </dl>
      <button type="button" className="log-toggle" onClick={onToggleLog} aria-expanded={logOpen}>
        {logOpen ? 'HIDE EVENT LOG' : 'VIEW EVENT LOG'} <ArrowDownRight size={15} />
      </button>
    </section>
  )
}
