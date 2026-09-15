import { Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFaultControl } from '../lab/hooks'
import {
  clearServiceWorkerLog,
  LOG_CAPACITY,
  LOG_TAGS,
  type LogTag,
  useServiceWorker,
} from '../telemetry/serviceWorker'
import { PanelHeader } from './PanelHeader'
import './EventLog.css'

const HIDDEN_TAGS_KEY = 'darkflib:event-log:hidden-tags'

// A per-viewer convenience, so browser storage is fine; it may be unavailable (private mode, blocked storage).
function readHiddenTags(): Set<LogTag> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_TAGS_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? LOG_TAGS.filter((tag) => stored.includes(tag)) : [])
  } catch {
    return new Set()
  }
}

export function EventLog() {
  const worker = useServiceWorker()
  const faults = useFaultControl()
  const faultHosts = faults.applied.map((rule) => new URL(rule.origin).host)
  const [hidden, setHidden] = useState(readHiddenTags)

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_TAGS_KEY, JSON.stringify([...hidden]))
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, [hidden])

  const toggle = (tag: LogTag) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })

  const visible = worker.entries.filter((entry) => !hidden.has(entry.tag))

  return (
    <section className="event-panel panel" aria-label="Service worker event log">
      <PanelHeader
        title="EVENT_LOG"
        meta={
          <small data-testid="sw-log-count">
            {visible.length} shown · {worker.entries.length} / {LOG_CAPACITY} · UTC
          </small>
        }
      >
        <div className="log-controls">
          {LOG_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-toggle tag-${tag}`}
              aria-pressed={!hidden.has(tag)}
              onClick={() => toggle(tag)}
            >
              {tag.toUpperCase()}
            </button>
          ))}
          <button type="button" className="log-clear" onClick={clearServiceWorkerLog}>
            CLEAR LOG
          </button>
        </div>
      </PanelHeader>
      <ol data-testid="sw-log">
        {visible.length === 0 ? (
          <li className="empty-log">
            {worker.entries.length === 0 ? 'No events yet.' : 'All events hidden by filter.'}
          </li>
        ) : (
          [...visible].reverse().map((entry) => (
            <li key={entry.id} className={`level-${entry.level}`} data-tag={entry.tag}>
              <time dateTime={entry.timestamp}>{entry.timestamp.slice(11, 23)}</time>
              <span className={entry.source === 'service-worker' ? 'sw-source' : ''}>
                {entry.source === 'service-worker' ? 'WORKER' : 'PAGE'}
              </span>
              <span className={`tag tag-${entry.tag}`}>{entry.tag.toUpperCase()}</span>
              <strong>{entry.event}</strong>
              <em>{entry.detail}</em>
            </li>
          ))
        )}
      </ol>
      <p className="log-note" data-testid="sw-log-note">
        <Radio size={14} />{' '}
        {faultHosts.length === 0
          ? 'Requests are observed, never modified: the worker does not respond to them. No fault injection is active.'
          : `Fault injection is active for ${faultHosts.join(', ')}: the worker answers those requests itself, in this tab only. Everything else is observed, never modified.`}
      </p>
    </section>
  )
}
