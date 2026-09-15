import { Radio } from 'lucide-react'
import { clearServiceWorkerLog, useServiceWorker } from '../serviceWorker'
import { PanelHeader } from './PanelHeader'

export function EventLog() {
  const worker = useServiceWorker()

  return (
    <section className="event-panel panel" aria-label="Service worker event log">
      <PanelHeader title="EVENT_LOG" meta={<small>{worker.entries.length} / 200</small>}>
        <button type="button" onClick={clearServiceWorkerLog}>
          CLEAR LOG
        </button>
      </PanelHeader>
      <ol>
        {worker.entries.length === 0 ? (
          <li className="empty-log">No events yet.</li>
        ) : (
          [...worker.entries].reverse().map((entry) => (
            <li key={entry.id}>
              <time>
                {new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false })}.
                {entry.timestamp.slice(20, 23)}
              </time>
              <span className={entry.source === 'service-worker' ? 'sw-source' : ''}>
                {entry.source === 'service-worker' ? 'WORKER' : 'PAGE'}
              </span>
              <strong>{entry.event}</strong>
              <em>{entry.detail}</em>
            </li>
          ))
        )}
      </ol>
      <p className="log-note">
        <Radio size={14} /> Lifecycle telemetry only. No request interception or fault injection is active.
      </p>
    </section>
  )
}
