import { edgeStatus } from './edge'
import { createStore } from './externalStore'

export interface NavigationTelemetry {
  /** ALPN protocol for the document request, e.g. `H2`. Null if the browser does not expose it. */
  protocol: string | null
  /** Time to first byte of the document, from navigation start. */
  ttfbMs: number | null
  /** Whether the document came from the HTTP cache (no bytes transferred). */
  fromCache: boolean | null
  /** Edge cache status for the document itself, from Server-Timing. */
  edge: string | null
}

const PROTOCOL_LABELS: Record<string, string> = { 'http/1.0': 'HTTP/1.0', 'http/1.1': 'HTTP/1.1', h2: 'H2', h3: 'H3' }

function read(): NavigationTelemetry {
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  if (!entry) return { protocol: null, ttfbMs: null, fromCache: null, edge: null }
  const protocol = entry.nextHopProtocol ? (PROTOCOL_LABELS[entry.nextHopProtocol] ?? entry.nextHopProtocol) : null
  return {
    protocol: protocol?.toUpperCase() ?? null,
    ttfbMs: entry.responseStart > 0 ? Math.round(entry.responseStart - entry.startTime) : null,
    fromCache: entry.decodedBodySize > 0 ? entry.transferSize === 0 : null,
    edge: edgeStatus(entry),
  }
}

const store = createStore<NavigationTelemetry>({ protocol: null, ttfbMs: null, fromCache: null, edge: null }, (set) => {
  // responseStart is final once the document is interactive; read again after load in case sizes were pending.
  set(read())
  if (document.readyState !== 'complete') window.addEventListener('load', () => set(read()), { once: true })
})

export const useNavigationTelemetry = store.use
