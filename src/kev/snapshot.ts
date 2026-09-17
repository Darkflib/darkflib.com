/**
 * The KEV snapshot: CISA's Known Exploited Vulnerabilities as sre-tab carries them, written hourly to
 * `/feeds/kev.json` by `kev-snapshot` (see kev-snapshot/ and deploy/README.md) and served from this origin.
 *
 * Everything here is deliberately defensive about a document this origin wrote itself. It arrives over the network,
 * from a file a separate program produced, possibly from an older build than the page reading it; `version` is what
 * says the two agree, and an entry that does not parse is dropped rather than rendered.
 */

export const SNAPSHOT_URL = '/feeds/kev.json'
/** Bumped when this reader would have to change. kev-snapshot's FormatVersion must match. */
export const FORMAT_VERSION = 1
/** The fetcher runs hourly, so three missed refreshes. Past this the panel says the data is stale. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000
/** Past this the panel hides itself: a week-old list of "the latest" is worse than no list. */
export const HIDE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const CVE_ID = /^CVE-\d{4}-\d{4,}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

export interface KevEntry {
  cve: string
  /** CISA's name for the vulnerability; empty when the catalogue entry carried none. */
  name: string
  description: string
  /** When the catalogue added it, epoch ms. */
  added: number
  /** Federal remediation deadline, YYYY-MM-DD, or null. */
  due: string | null
  ransomware: boolean
  /** CISA's entry for this CVE, or null when the snapshot carried no usable link. */
  url: string | null
}

export interface KevSnapshot {
  /** When the fetcher last reached sre-tab, epoch ms: the age the panel reports. */
  fetchedAt: number
  /** Newest first. */
  entries: KevEntry[]
}

export interface KevWeek {
  /** Start of the week-long bucket, epoch ms. */
  start: number
  count: number
}

export interface KevSummary {
  week: number
  month: number
  quarter: number
  ransomware: number
  /** Oldest bucket first, ending at the snapshot's own time. */
  weeks: KevWeek[]
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null

function parseEntry(value: unknown): KevEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const cve = text(raw.cve, 40)
  const added = typeof raw.added === 'string' ? Date.parse(raw.added) : Number.NaN
  if (cve === null || !CVE_ID.test(cve) || Number.isNaN(added)) return null
  const due = text(raw.due, 10)
  // Only an https link on CISA's own host is rendered: anything else is dropped rather than turned into an anchor.
  const url = text(raw.url, 2048)
  return {
    cve,
    name: text(raw.name, 300) ?? '',
    description: text(raw.description, 1000) ?? '',
    added,
    due: due !== null && ISO_DATE.test(due) ? due : null,
    ransomware: raw.ransomware === true,
    url: url?.startsWith('https://www.cisa.gov/') ? url : null,
  }
}

export function parseSnapshot(value: unknown): KevSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const fetchedAt = typeof raw.fetched_at === 'string' ? Date.parse(raw.fetched_at) : Number.NaN
  if (raw.version !== FORMAT_VERSION || Number.isNaN(fetchedAt) || !Array.isArray(raw.entries)) return null

  const entries = raw.entries.map(parseEntry).filter((entry): entry is KevEntry => entry !== null)
  if (entries.length === 0) return null
  entries.sort((a, b) => b.added - a.added)
  return { fetchedAt, entries }
}

/**
 * The snapshot, or null when there is none to show: 204 before the first refresh or with no token configured on the
 * host, and anything unreadable. A missing panel is the failure mode, never a broken one.
 */
export async function fetchSnapshot(signal?: AbortSignal): Promise<KevSnapshot | null> {
  const response = await fetch(SNAPSHOT_URL, { signal })
  if (response.status === 204 || !response.ok) return null
  try {
    return parseSnapshot(await response.json())
  } catch {
    return null
  }
}

/**
 * Counts relative to the snapshot's own time rather than the reader's clock, so the windows describe the data and
 * stay honest whatever the age of the file or the skew of the browser.
 */
export function summarise(snapshot: KevSnapshot, weeks = 13): KevSummary {
  const since = (days: number) =>
    snapshot.entries.filter((entry) => entry.added > snapshot.fetchedAt - days * DAY_MS).length

  const buckets: KevWeek[] = Array.from({ length: weeks }, (_, index) => ({
    start: snapshot.fetchedAt - (weeks - index) * WEEK_MS,
    count: 0,
  }))
  for (const entry of snapshot.entries) {
    const index = Math.floor((entry.added - buckets[0].start) / WEEK_MS)
    if (index >= 0 && index < weeks) buckets[index].count += 1
  }

  return {
    week: since(7),
    month: since(30),
    quarter: since(90),
    ransomware: snapshot.entries.filter((entry) => entry.ransomware).length,
    weeks: buckets,
  }
}

/** A coarse age: minutes, then hours, then days. Never smaller than a minute — the file changes hourly. */
export function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}M`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}H` : `${Math.floor(hours / 24)}D`
}

/** YYYY-MM-DD in UTC, as the catalogue itself dates entries. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
