// Messages exchanged between the page and the service worker. Shared by both builds, so no DOM or worker globals.

export type LogLevel = 'info' | 'warn' | 'error'

export interface WorkerLogEntry {
  /** Epoch milliseconds when the worker emitted the event. Delivery can lag, especially before a page is controlled. */
  time: number
  level: LogLevel
  event: string
  detail?: string
}

/** A request seen by the worker's fetch listener. Metadata only: the worker never touches the response. */
export interface ObservedRequest {
  /** Epoch milliseconds when the fetch event fired. */
  time: number
  method: string
  url: string
  /** RequestDestination, e.g. `document`, `script`, `image`; empty for fetch() and XHR. */
  destination: string
  /** RequestMode, e.g. `navigate`, `cors`, `no-cors`, `same-origin`. */
  mode: string
  /** Present when the worker answered this request with an injected fault instead of letting it through. */
  fault?: { mode: FaultMode; detail: string }
}

export type FaultMode = 'offline' | 'latency' | 'status'

/**
 * One Fault Lab rule, scoped to the tab that set it. The worker answers matching requests itself; every other request
 * passes through untouched. Rules never apply to navigations or to the site's own origin.
 */
export interface FaultRule {
  /** Origin the rule applies to, e.g. `https://api.darkflib.com`. */
  origin: string
  /** offline: network error, no request sent. latency: delay, then the real request. status: synthetic 429/503. */
  mode: FaultMode
  /** Share of matching requests affected, from 0 to 1. */
  probability: number
  /** Delay before the real request, for `latency`. */
  latencyMs?: number
  /** Status for `status`. */
  status?: 429 | 503
  /** Retry-After seconds sent with `status`. */
  retryAfterSeconds?: number
}

export const MAX_FAULT_RULES = 8
export const MAX_LATENCY_MS = 30_000

/**
 * Features a worker build implements, each with a version. The page checks these rather than assuming its controller
 * matches its own build: without skipWaiting(), an old worker can control new pages across many deploys.
 */
export type Capabilities = Readonly<Record<string, number>>

/** What this build's worker implements. Bump a version when a capability's messages change incompatibly. */
export const WORKER_CAPABILITIES = {
  'fetch-observer': 1,
  'fault-injection': 1,
} as const satisfies Capabilities

/**
 * Page → worker. Both expect a reply on a transferred MessagePort. `fault:set` replaces this tab's whole rule set (an
 * empty list clears it) and is answered with the rules the worker actually holds.
 */
export type ClientMessage = { type: 'sw:hello' } | { type: 'fault:set'; rules: FaultRule[] }

/** Worker → page. */
export type WorkerMessage =
  | { type: 'sw:log'; entry: WorkerLogEntry }
  // capabilities is absent from workers deployed before it existed; treat that as none.
  | { type: 'sw:hello:reply'; version: string; capabilities?: Capabilities }
  // activeFaults: rules the worker holds for this tab when it sent the batch, so the page can notice a worker restart
  // (rules live in worker memory) and re-send. Absent from workers without fault-injection.
  | { type: 'sw:requests'; requests: ObservedRequest[]; activeFaults?: number }
  | { type: 'fault:ack'; rules: FaultRule[]; rejected: { origin: string; reason: string }[] }

/** Upper bound on a single `sw:requests` batch; the worker never sends more. */
export const MAX_REQUEST_BATCH = 200

const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(['info', 'warn', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const FAULT_MODES: ReadonlySet<string> = new Set<FaultMode>(['offline', 'latency', 'status'])

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).origin === value
  } catch {
    return false
  }
}

export function isFaultRule(value: unknown): value is FaultRule {
  if (!isRecord(value) || !isOrigin(value.origin) || typeof value.mode !== 'string' || !FAULT_MODES.has(value.mode)) {
    return false
  }
  if (typeof value.probability !== 'number' || !(value.probability >= 0 && value.probability <= 1)) return false
  switch (value.mode) {
    case 'latency':
      return (
        Number.isInteger(value.latencyMs) &&
        (value.latencyMs as number) >= 0 &&
        (value.latencyMs as number) <= MAX_LATENCY_MS
      )
    case 'status':
      return (
        (value.status === 429 || value.status === 503) &&
        (value.retryAfterSeconds === undefined ||
          (Number.isInteger(value.retryAfterSeconds) &&
            (value.retryAfterSeconds as number) >= 0 &&
            (value.retryAfterSeconds as number) <= 3600))
      )
    default:
      return true
  }
}

function isObservedRequest(value: unknown): value is ObservedRequest {
  return (
    isRecord(value) &&
    (value.fault === undefined ||
      (isRecord(value.fault) &&
        typeof value.fault.mode === 'string' &&
        FAULT_MODES.has(value.fault.mode) &&
        typeof value.fault.detail === 'string')) &&
    typeof value.time === 'number' &&
    Number.isFinite(value.time) &&
    typeof value.method === 'string' &&
    typeof value.url === 'string' &&
    typeof value.destination === 'string' &&
    typeof value.mode === 'string'
  )
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false
  if (value.type === 'sw:hello') return true
  return value.type === 'fault:set' && Array.isArray(value.rules) && value.rules.length <= MAX_FAULT_RULES
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'sw:log': {
      const entry = value.entry
      return (
        isRecord(entry) &&
        typeof entry.time === 'number' &&
        Number.isFinite(entry.time) &&
        typeof entry.level === 'string' &&
        LOG_LEVELS.has(entry.level) &&
        typeof entry.event === 'string' &&
        (entry.detail === undefined || typeof entry.detail === 'string')
      )
    }
    case 'sw:hello:reply':
      return (
        typeof value.version === 'string' &&
        (value.capabilities === undefined ||
          (isRecord(value.capabilities) &&
            Object.values(value.capabilities).every(
              (version) => typeof version === 'number' && Number.isInteger(version) && version > 0,
            )))
      )
    case 'sw:requests':
      return (
        Array.isArray(value.requests) &&
        value.requests.length <= MAX_REQUEST_BATCH &&
        value.requests.every(isObservedRequest) &&
        (value.activeFaults === undefined || Number.isInteger(value.activeFaults))
      )
    case 'fault:ack':
      return (
        Array.isArray(value.rules) &&
        value.rules.every(isFaultRule) &&
        Array.isArray(value.rejected) &&
        value.rejected.every(
          (entry) => isRecord(entry) && typeof entry.origin === 'string' && typeof entry.reason === 'string',
        )
      )
    default:
      return false
  }
}
