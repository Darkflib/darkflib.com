// The Fault Lab's system under test: a status client that polls the primary API, retries and backs off, trips a
// circuit breaker, fails over to the secondary, and serves stale data when both are down. It knows nothing about the
// service worker; faults reach it only as failed requests.
import { recordEvent } from '../telemetry/serviceWorker'
import { type LabConfig, type LabTarget, type LabTargetId, loadLabConfig } from './config'
import { attempt, backoffDelay, CircuitBreaker, type CircuitState, describeOutcome, isRetryable } from './resilience'

export type SystemStatus = 'starting' | 'idle' | 'healthy' | 'failover' | 'stale' | 'down'

export interface TargetView {
  id: LabTargetId
  label: string
  origin: string
  circuit: CircuitState
  /** Latest attempt, as the client saw it. */
  lastOutcome: string | null
  lastOk: boolean | null
  checkedAt: number | null
}

export interface LabState {
  config: LabConfig | null
  configError: string | null
  status: SystemStatus
  /** Target whose data the page is currently showing (for stale, where it last came from). */
  servedBy: LabTargetId | null
  lastGoodAt: number | null
  media: 'unknown' | 'healthy' | 'degraded'
  targets: Partial<Record<LabTargetId, TargetView>>
}

let state: LabState = {
  config: null,
  configError: null,
  status: 'starting',
  servedBy: null,
  lastGoodAt: null,
  media: 'unknown',
  targets: {},
}
const listeners = new Set<() => void>()

function publish(patch: Partial<LabState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getLabState(): LabState {
  return state
}

export function subscribeLab(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const breakers = new Map<LabTargetId, CircuitBreaker>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function updateTarget(target: LabTarget, patch: Partial<TargetView>) {
  const current = state.targets[target.id] as TargetView
  publish({ targets: { ...state.targets, [target.id]: { ...current, ...patch } } })
}

function syncCircuit(target: LabTarget, before: CircuitState) {
  const breaker = breakers.get(target.id) as CircuitBreaker
  if (breaker.state === before) return
  updateTarget(target, { circuit: breaker.state })
  const detail =
    breaker.state === 'open'
      ? `${target.label}: refusing calls for ${Math.round((breaker.openUntil - Date.now()) / 1000)} s`
      : breaker.state === 'half-open'
        ? `${target.label}: allowing one trial call`
        : `${target.label}: calls flowing again`
  recordEvent('client', breaker.state === 'open' ? 'warn' : 'info', `circuit:${breaker.state}`, detail)
}

/** One resilient call: circuit check, attempt, retries with backoff or Retry-After, and the breaker's verdict. */
async function call(target: LabTarget, tuning: LabConfig['client']): Promise<boolean> {
  const breaker = breakers.get(target.id) as CircuitBreaker
  const initial = breaker.state
  if (!breaker.allow(Date.now())) return false
  syncCircuit(target, initial)

  const url = `${target.origin}${target.path}`
  for (let retry = 0; ; retry += 1) {
    const outcome = await attempt(url, tuning.requestTimeoutMs)
    updateTarget(target, {
      lastOutcome: describeOutcome(outcome),
      lastOk: outcome.kind === 'ok',
      checkedAt: Date.now(),
    })

    if (outcome.kind === 'ok') {
      const before = breaker.state
      breaker.success()
      syncCircuit(target, before)
      return true
    }

    const retryAfterMs = outcome.kind === 'http' ? outcome.retryAfterMs : null
    if (retryAfterMs !== null && retryAfterMs > tuning.maxRetryAfterMs) {
      // The server asked for a longer back-off than a retry loop should wait: stop calling it until then.
      const before = breaker.state
      breaker.failure(Date.now(), retryAfterMs)
      recordEvent(
        'client',
        'warn',
        'retry-after',
        `${target.label}: ${describeOutcome(outcome)}, backing off ${Math.round(retryAfterMs / 1000)} s`,
      )
      syncCircuit(target, before)
      return false
    }

    if (!isRetryable(outcome) || retry >= tuning.maxRetries) {
      const before = breaker.state
      breaker.failure(Date.now())
      recordEvent(
        'client',
        'warn',
        'call:failed',
        `${target.label}: ${describeOutcome(outcome)} after ${retry + 1} attempt(s)`,
      )
      syncCircuit(target, before)
      return false
    }

    const waitMs = retryAfterMs ?? backoffDelay(retry, tuning.backoffBaseMs, tuning.backoffCapMs)
    recordEvent(
      'client',
      'info',
      'retry',
      `${target.label}: ${describeOutcome(outcome)}; attempt ${retry + 2} in ${waitMs} ms${retryAfterMs !== null ? ' (Retry-After)' : ' (backoff)'}`,
    )
    await sleep(waitMs)
  }
}

function transition(status: SystemStatus, servedBy: LabTargetId | null, detail: string) {
  if (status === state.status && servedBy === state.servedBy) return
  const level = status === 'healthy' ? 'info' : status === 'failover' ? 'warn' : 'error'
  recordEvent('client', level, `state:${status}`, detail)
  publish({ status, servedBy })
}

async function cycle(config: LabConfig) {
  const { targets, client } = config
  const primary = targets['api-primary']
  const secondary = targets['api-secondary']

  if (await call(primary, client)) {
    publish({ lastGoodAt: Date.now() })
    transition('healthy', 'api-primary', `served by ${primary.label}`)
  } else if (await call(secondary, client)) {
    publish({ lastGoodAt: Date.now() })
    transition('failover', 'api-secondary', `${primary.label} unavailable; served by ${secondary.label}`)
  } else if (state.lastGoodAt !== null) {
    transition(
      'stale',
      state.servedBy,
      `both APIs unavailable; showing data from ${Math.round((Date.now() - state.lastGoodAt) / 1000)} s ago`,
    )
  } else {
    transition('down', null, 'both APIs unavailable and no earlier data to show')
  }

  const media = (await call(targets.media, client)) ? 'healthy' : 'degraded'
  if (media !== state.media) {
    recordEvent('client', media === 'healthy' ? 'info' : 'warn', `media:${media}`, targets.media.label)
    publish({ media })
  }
}

let started = false

/** Load the config and poll for the life of the page, pausing while the tab is hidden. Idempotent. */
export function startStatusClient() {
  if (started) return
  started = true

  void loadLabConfig().then(
    (config) => {
      for (const target of Object.values(config.targets)) {
        breakers.set(target.id, new CircuitBreaker(config.client.circuitThreshold, config.client.circuitOpenMs))
      }
      const targets = Object.fromEntries(
        Object.values(config.targets).map((target) => [
          target.id,
          {
            id: target.id,
            label: target.label,
            origin: target.origin,
            circuit: 'closed',
            lastOutcome: null,
            lastOk: null,
            checkedAt: null,
          },
        ]),
      ) as LabState['targets']
      publish({ config, targets })
      if (!config.client.enabled) {
        publish({ status: 'idle' })
        recordEvent('client', 'info', 'client:disabled', 'polling is switched off in /lab/config.json')
        return
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      let running = false
      const run = async () => {
        if (running || document.hidden) return
        running = true
        try {
          await cycle(config)
        } finally {
          running = false
          clearTimeout(timer)
          if (!document.hidden) timer = setTimeout(run, config.client.pollIntervalMs)
        }
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(timer)
        else void run()
      })
      void run()
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      publish({ configError: message })
      recordEvent('client', 'error', 'config:failed', message)
    },
  )
}
