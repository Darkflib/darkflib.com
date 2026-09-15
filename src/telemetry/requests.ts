import { createStore } from './externalStore'

export interface RequestSample {
  id: number
  /** Path (same-origin) or origin plus path, for tooltips. */
  name: string
  durationMs: number
  /** No bytes over the network: HTTP cache hit, or a cross-origin response without Timing-Allow-Origin. */
  cached: boolean
}

export const REQUEST_HISTORY = 62

let nextId = 0

function toSample(entry: PerformanceResourceTiming): RequestSample {
  const url = new URL(entry.name)
  return {
    id: ++nextId,
    name: url.origin === window.location.origin ? url.pathname : `${url.host}${url.pathname}`,
    durationMs: Math.round(entry.duration),
    cached: entry.transferSize === 0,
  }
}

// Resource Timing for every subresource this page fetches. Once the Fault Lab injects latency in the service
// worker, it shows up here without any extra wiring.
const store = createStore<readonly RequestSample[]>([], (set) => {
  if (typeof PerformanceObserver === 'undefined') return
  let samples: readonly RequestSample[] = []
  const observer = new PerformanceObserver((list) => {
    const incoming = (list.getEntries() as PerformanceResourceTiming[]).map(toSample)
    samples = [...samples, ...incoming].slice(-REQUEST_HISTORY)
    set(samples)
  })
  observer.observe({ type: 'resource', buffered: true })
})

export const useRequestSamples = store.use
