import { useClock } from '../hooks/useClock'
import { buildInfo, buildLabel } from '../telemetry/build'
import { summariseEdge } from '../telemetry/edge'
import { useNavigationTelemetry } from '../telemetry/navigation'
import { REQUEST_HISTORY, type RequestSample, useRequestSamples } from '../telemetry/requests'
import { type ServiceWorkerSnapshot, useServiceWorker } from '../telemetry/serviceWorker'
import './SystemsStrip.css'

const MAX_BAR_PX = 24
const MIN_BAR_PX = 3
/** Durations at or above this saturate the bar. Log scale, so 10 ms and 1 s are both legible. */
const SATURATION_MS = 2000
const SLOW_MS = 800
const EMPTY_SLOTS = Array.from({ length: REQUEST_HISTORY }, (_, index) => `empty-${index}`)

function workerStatus(worker: ServiceWorkerSnapshot): { label: string; tone: 'on' | 'pending' | 'off' | 'warn' } {
  if (worker.controlled) {
    if (worker.slots.waiting) return { label: 'CONTROLLING · UPDATE WAITING', tone: 'on' }
    // Older than this page expects: features that depend on the worker stay unavailable until it updates.
    if (worker.missingCapabilities.length) return { label: 'CONTROLLING · OUTDATED', tone: 'pending' }
    return { label: 'CONTROLLING', tone: 'on' }
  }
  switch (worker.registration) {
    case 'failed':
      return { label: 'FAILED', tone: 'warn' }
    case 'unsupported':
      return { label: 'UNSUPPORTED', tone: 'off' }
    case 'disabled':
      return { label: 'OFF', tone: 'off' }
    default:
      return { label: 'STARTING', tone: 'pending' }
  }
}

function barHeight(durationMs: number): number {
  const ratio = Math.min(1, Math.log10(1 + durationMs) / Math.log10(1 + SATURATION_MS))
  return Math.round(MIN_BAR_PX + (MAX_BAR_PX - MIN_BAR_PX) * ratio)
}

function LatencyBars({ samples }: { samples: readonly RequestSample[] }) {
  const slowest = samples.reduce((max, sample) => Math.max(max, sample.durationMs), 0)
  const summary = samples.length
    ? `Request latency, last ${samples.length} requests, slowest ${slowest} ms`
    : 'Request latency, no requests yet'

  return (
    <div className="signal-bars" role="img" aria-label={summary} title={summary} data-testid="strip-requests">
      {EMPTY_SLOTS.slice(samples.length).map((key) => (
        <i key={key} className="empty" />
      ))}
      {samples.map((sample) => (
        <i
          key={sample.id}
          className={[sample.cached ? 'cached' : '', sample.durationMs >= SLOW_MS ? 'slow' : ''].join(' ').trim()}
          style={{ height: `${barHeight(sample.durationMs)}px` }}
          title={`${sample.name} ${sample.durationMs} ms${sample.cached ? ' (browser cache)' : sample.edge ? ` (edge ${sample.edge})` : ''}`}
        />
      ))}
    </div>
  )
}

export function SystemsStrip() {
  const clock = useClock()
  const worker = workerStatus(useServiceWorker())
  const navigation = useNavigationTelemetry()
  const samples = useRequestSamples()
  const edge = summariseEdge(navigation, samples)

  return (
    <section className="systems-strip" aria-label="Live site telemetry">
      <div data-testid="strip-sw">
        <span className={`live-dot ${worker.tone}`} /> SW: {worker.label}
      </div>
      <div data-testid="strip-build" title={`Built ${buildInfo.time}`}>
        BUILD: {buildLabel}
      </div>
      <div className="strip-wide" data-testid="strip-protocol" title="Protocol negotiated for this document">
        PROTO: {navigation.protocol ?? '—'}
      </div>
      <div className="strip-wide" data-testid="strip-edge" title={`Edge cache: ${edge.detail}`}>
        EDGE: {edge.label}
      </div>
      <div
        className="strip-medium"
        data-testid="strip-ttfb"
        title={`Time to first byte for this document; ${
          navigation.workerStartupMs === null
            ? 'not routed through a service worker'
            : `via service worker, startup ${navigation.workerStartupMs} ms`
        }`}
      >
        TTFB: {navigation.ttfbMs === null ? '—' : `${navigation.ttfbMs} MS`}
        {navigation.fromCache ? ' (CACHE)' : ''}
      </div>
      <div>UTC: {clock}</div>
      <LatencyBars samples={samples} />
      <div className="strip-wide">IDEAS &gt; CODE &gt; IMPACT</div>
    </section>
  )
}
