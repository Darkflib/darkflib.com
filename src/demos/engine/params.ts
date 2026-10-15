export type Variability = 'low' | 'exp' | 'heavy'
export type QueuePolicy = 'unbounded' | 'drop' | 'block' | 'codel'
export type Discipline = 'fifo' | 'lifo'

/** Every knob the engine has. A demo fixes most of them and exposes the few its concept depends on. */
export interface Params {
  /** Fresh arrivals per second (Poisson). Retries come on top. */
  lambda: number
  /** Worker pool size, 1 to MAX_WORKERS. */
  workers: number
  /** Mean service time. */
  svcMs: number
  variability: Variability
  policy: QueuePolicy
  /** Queue limit, for every policy but unbounded. */
  cap: number
  /** Shed anything queued longer than this (codel policy). */
  ageMs: number
  discipline: Discipline
  /** Client timeout per attempt. */
  timeoutMs: number
  /** Retries after the first attempt. */
  retries: number
  /** Base of the exponential backoff between attempts. */
  backoffMs: number
  /** Full jitter on the backoff; off means retries fire in lockstep. */
  jitter: boolean
  /**
   * Retry budget, as retries allowed per fresh request (0.1 = at most one retry per ten requests, over time). Each
   * fresh request deposits this much; each retry spends one. Null means no budget: every timeout may retry.
   */
  retryBudget: number | null
  /** Skip queued work whose client has already given up. */
  dropExpired: boolean
}

export const MAX_WORKERS = 32

/** Most retries a budget can bank, so a quiet spell cannot fund an unbounded burst. */
export const RETRY_BUDGET_CAP = 10

export const DEFAULTS: Readonly<Params> = {
  lambda: 56,
  workers: 8,
  svcMs: 100,
  variability: 'exp',
  policy: 'unbounded',
  cap: 200,
  ageMs: 100,
  discipline: 'fifo',
  timeoutMs: 1000,
  retries: 2,
  backoffMs: 100,
  jitter: true,
  retryBudget: null,
  dropExpired: false,
}

/** Squared coefficient of variation of service time, per shape. */
export const SERVICE_CS2: Record<Variability, number> = { low: 0.0625, exp: 1, heavy: 9 }

/** Capacity in requests per second, before any slow-dependency multiplier. */
export const capacity = (p: Pick<Params, 'workers' | 'svcMs'>) => p.workers / (p.svcMs / 1000)

/** Utilisation the fresh load alone would cause. */
export const utilisation = (p: Params) => p.lambda / capacity(p)
