import { ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useNow } from '../hooks/useNow'
import { useKevSnapshot } from '../kev/hooks'
import {
  formatAge,
  HIDE_AFTER_MS,
  isoDate,
  type KevEntry,
  type KevWeek,
  STALE_AFTER_MS,
  summarise,
} from '../kev/snapshot'
import { PanelHeader } from './PanelHeader'
import './KevPanel.css'

/** Rows shown before SHOW ALL. Enough to read at a glance without turning the page into a vulnerability feed. */
const PREVIEW_ROWS = 8
const DAY_MS = 24 * 60 * 60 * 1000
/** A deadline inside this window is marked; the catalogue usually gives about three weeks. */
const DUE_SOON_MS = 7 * DAY_MS
const NVD_URL = 'https://nvd.nist.gov/vuln/detail/'

function Bars({ weeks }: { weeks: KevWeek[] }) {
  const peak = Math.max(1, ...weeks.map((week) => week.count))
  const label = `Entries added per week over ${weeks.length} weeks, oldest first: ${weeks.map((w) => w.count).join(', ')}`
  return (
    <div className="kev-bars" data-testid="kev-bars" role="img" aria-label={label}>
      {weeks.map((week) => (
        <i
          key={week.start}
          className={week.count === 0 ? 'empty' : undefined}
          // Inline heights, as in the telemetry strip: React sets them through the CSSOM, which style-src does not
          // govern, so the CSP stays 'self' with no hashes.
          style={{ height: `${Math.max(2, Math.round((week.count / peak) * 100))}%` }}
          title={`Week of ${isoDate(week.start)}: ${week.count}`}
        />
      ))}
    </div>
  )
}

function Row({ entry, now }: { entry: KevEntry; now: number }) {
  // The deadline is a calendar date, and an agency patching on the day has met it: it runs to the end of that day.
  const deadline = entry.due === null ? null : Date.parse(`${entry.due}T00:00:00Z`) + DAY_MS
  const overdue = deadline !== null && deadline <= now
  const soon = deadline !== null && !overdue && deadline - now < DUE_SOON_MS
  return (
    <li>
      <details className="kev-entry" data-testid="kev-entry">
        <summary>
          <ChevronRight className="kev-chevron" size={13} strokeWidth={2} aria-hidden="true" />
          <time dateTime={isoDate(entry.added)}>{isoDate(entry.added)}</time>
          <span className="kev-cve">{entry.cve}</span>
          <span className="kev-name">{entry.name || 'Catalogue entry'}</span>
          <span className="kev-tags">
            {entry.ransomware && <span className="kev-tag kev-ransomware">RANSOMWARE</span>}
            {entry.due && (
              <span
                className={`kev-tag kev-due${overdue ? ' kev-overdue' : soon ? ' kev-soon' : ''}`}
                title={`US federal remediation deadline: ${entry.due}`}
              >
                {overdue ? 'PAST DUE' : `DUE ${entry.due.slice(5)}`}
              </span>
            )}
          </span>
        </summary>
        <div className="kev-detail">
          {entry.description && <p>{entry.description}</p>}
          <p className="kev-links">
            <a href={`${NVD_URL}${entry.cve}`}>
              NVD <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden="true" />
            </a>
            {entry.url && (
              <a href={entry.url}>
                CISA CATALOGUE <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden="true" />
              </a>
            )}
            {entry.due && (
              <span className="kev-deadline">
                {overdue ? 'Federal deadline passed' : 'Federal remediation due'} {entry.due}
              </span>
            )}
          </p>
        </div>
      </details>
    </li>
  )
}

/**
 * The KEV panel: what CISA says is being exploited right now, taken from this site's own origin. The document behind
 * it is fetched from sre-tab on the server, so no credential reaches the browser and visitors never touch that API.
 */
export function KevPanel({ onOpenSource }: { onOpenSource: () => void }) {
  const snapshot = useKevSnapshot()
  // A minute is fine: the file it describes changes hourly, and this only moves "SYNCED 14M AGO" along.
  const now = useNow(60_000)
  const [showAll, setShowAll] = useState(false)

  if (snapshot === null) return null
  const age = now - snapshot.fetchedAt
  if (age > HIDE_AFTER_MS) return null

  const summary = summarise(snapshot)
  const rows = showAll ? snapshot.entries : snapshot.entries.slice(0, PREVIEW_ROWS)

  return (
    <section className="panel kev-panel" id="kev" aria-labelledby="kev-title">
      <PanelHeader id="kev-title" title="KNOWN_EXPLOITED" meta={<span className="kev-badge">CISA KEV</span>}>
        <button type="button" className="panel-link kev-source" onClick={onOpenSource}>
          VIA SRE-TAB <ArrowRight size={14} aria-hidden="true" />
        </button>
      </PanelHeader>
      <p className="kev-note">
        Vulnerabilities CISA has seen exploited in the wild, mirrored hourly from my own sre-tab instance. Dates are
        when the catalogue added them; the deadlines bind US federal agencies, and make a reasonable patch clock for
        everyone else.
      </p>
      <div className="kev-body">
        <div className="kev-side">
          <dl className="kev-stats" data-testid="kev-stats">
            <div>
              <dt>7 DAYS</dt>
              <dd>{summary.week}</dd>
            </div>
            <div>
              <dt>30 DAYS</dt>
              <dd>{summary.month}</dd>
            </div>
            <div>
              <dt>90 DAYS</dt>
              <dd>{summary.quarter}</dd>
            </div>
            <div>
              <dt>RANSOMWARE</dt>
              <dd className="kev-count-flag">{summary.ransomware}</dd>
            </div>
          </dl>
          <div className="kev-weeks">
            <span className="kev-caption">ADDED / WEEK</span>
            <Bars weeks={summary.weeks} />
            <span className="kev-axis">
              <span>{summary.weeks.length} WEEKS</span>
              <span>NOW</span>
            </span>
          </div>
          <p className={`kev-sync${age > STALE_AFTER_MS ? ' kev-stale' : ''}`} data-testid="kev-sync">
            {age > STALE_AFTER_MS && 'STALE · '}SYNCED {formatAge(age)} AGO
          </p>
        </div>
        <div className="kev-feed">
          <ol className="kev-list" data-testid="kev-list">
            {rows.map((entry) => (
              <Row key={entry.cve} entry={entry} now={now} />
            ))}
          </ol>
          {snapshot.entries.length > PREVIEW_ROWS && (
            <button type="button" className="kev-more" onClick={() => setShowAll((open) => !open)}>
              {showAll ? `SHOW LATEST ${PREVIEW_ROWS}` : `SHOW ALL ${snapshot.entries.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
