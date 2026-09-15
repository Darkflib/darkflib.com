import type { RequestSample } from './requests'

/** Server-Timing metric name that host nginx uses for its cache status (deploy/nginx/darkflib.conf). */
const EDGE_METRIC = 'edge'

/** nginx cache statuses where the body came from the edge cache rather than the origin. */
const FROM_EDGE_CACHE: ReadonlySet<string> = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])

/** The edge cache status a response carried, or null if nothing in front of the origin reported one. */
export function edgeStatus(entry: PerformanceResourceTiming): string | null {
  const metric = entry.serverTiming?.find((timing) => timing.name === EDGE_METRIC)
  return metric?.description ? metric.description.toUpperCase() : null
}

export interface EdgeSummary {
  label: string
  detail: string
}

/**
 * Summarise what the edge did for this page. Only responses that crossed the network count: a browser-cache hit
 * replays the Server-Timing header stored with the response, so it would report the edge's answer from an earlier
 * visit (measured in Chromium, Firefox, and WebKit against the live site).
 */
export function summariseEdge(
  document: { edge: string | null; fromCache: boolean | null },
  samples: readonly RequestSample[],
): EdgeSummary {
  // The site's own edge cache only: the Fault Lab origins pass through the same nginx but are never cached.
  const reported = samples.filter((sample) => sample.sameOrigin && sample.edge !== null)
  if (document.edge === null && reported.length === 0) {
    return { label: '—', detail: 'No edge cache reports on this origin' }
  }

  const documentPart = `document: ${document.edge ?? 'not reported'}${document.fromCache ? ' (replayed from browser cache)' : ''}`
  if (reported.length === 0) {
    return { label: document.edge ?? '—', detail: `${documentPart}; no subresources reported yet` }
  }

  const statuses = reported.filter((sample) => !sample.cached).map((sample) => sample.edge ?? '')
  if (statuses.length === 0) {
    return { label: 'LOCAL', detail: `${documentPart}; every subresource came from this browser's cache` }
  }

  const counts = new Map<string, number>()
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1)
  const hits = statuses.filter((status) => FROM_EDGE_CACHE.has(status)).length
  const breakdown = [...counts].map(([status, count]) => `${count} ${status}`).join(', ')
  return {
    label: `${hits}/${statuses.length} HIT`,
    detail: `${documentPart}; network-fetched subresources: ${breakdown}`,
  }
}
