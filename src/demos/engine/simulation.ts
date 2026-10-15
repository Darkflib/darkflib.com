// A discrete-event simulation of one service: Poisson arrivals, a worker pool, a queue with an admission policy,
// and clients that time out and retry. Ported from the Backpressure Lab prototype, with seeded randomness so a
// preset tells the same story every run. No DOM here: the demos draw it, and tests/unit drive it headless.
import { capacity, DEFAULTS, MAX_WORKERS, type Params, RETRY_BUDGET_CAP } from './params.ts'
import { Random } from './random.ts'
import { Deque, Heap } from './structures.ts'
import { theoreticalWait } from './theory.ts'

/** Seconds of simulated time per metrics bucket. */
export const SAMPLE_SECONDS = 0.25
/** Buckets in the rolling window the readouts summarise (2 s). */
const WINDOW_BUCKETS = 8
/** Samples kept for charts (60 s). */
export const HISTORY_SAMPLES = 240
/** Past this many queued or blocked requests the run stops, as a real process would be killed. */
export const OOM_LIMIT = 50_000

export type RequestState = 'new' | 'held' | 'queued' | 'service' | 'done' | 'rejected' | 'skipped'

export interface Request {
  id: number
  /** When the first attempt was made: end-to-end latency counts from here. */
  born: number
  /** 0 for the first attempt. */
  attempt: number
  /** When this attempt entered the system. */
  enq: number
  state: RequestState
  /** The client has timed out on this attempt; serving it now is wasted work. */
  abandoned: boolean
  retried: boolean
}

export interface Worker {
  req: Request | null
  start: number
  until: number
  dur: number
}

/** Something a script or a button can make happen. */
export type Disturbance = 'spike' | 'slow'

/** A disturbance at a fixed simulated time, so a preset can stage its trigger. */
export interface ScriptEvent {
  at: number
  action: Disturbance
}

/** Hook for the renderer's particles. Not part of the model. */
export type FlowEvent = 'arrive' | 'drop' | 'skip' | 'ok' | 'waste'

type SimEvent =
  | { t: number; type: 'gen'; dead?: boolean }
  | { t: number; type: 'retry'; req: Request }
  | { t: number; type: 'timeout'; req: Request }
  | { t: number; type: 'done'; worker: Worker }
  | { t: number; type: 'spikeEnd' }
  | { t: number; type: 'disturb'; action: Disturbance }

interface Bucket {
  arr: number
  fresh: number
  good: number
  drops: number
  timeouts: number
  wasted: number
  expired: number
  retries: number
  lost: number
  /** Retries the budget refused. */
  denied: number
  comp: number
  lat: number[]
  e2e: number[]
  /** Integral of number-in-system over time, for Little's law. */
  area: number
  leave: number
  /** Total time in system of everything that left. */
  soj: number
  waitSum: number
  waitN: number
}

const newBucket = (): Bucket => ({
  arr: 0,
  fresh: 0,
  good: 0,
  drops: 0,
  timeouts: 0,
  wasted: 0,
  expired: 0,
  retries: 0,
  lost: 0,
  denied: 0,
  comp: 0,
  lat: [],
  e2e: [],
  area: 0,
  leave: 0,
  soj: 0,
  waitSum: 0,
  waitN: 0,
})

/** One metrics sample: the rolling window ending at `t`. Rates are per second; times are seconds. */
export interface Sample {
  t: number
  /** Arrivals including retries. */
  offered: number
  fresh: number
  /** Completions the client was still waiting for. */
  good: number
  /** Rejected plus expired. */
  shed: number
  drops: number
  expired: number
  timeouts: number
  retries: number
  /** Requests whose client ran out of retries (or budget). */
  lost: number
  /** Retries the budget refused. */
  denied: number
  /** Share of completions served after the client gave up. */
  wastedPct: number
  /** Server latency (queue wait plus service), this attempt only. */
  p50: number
  p99: number
  /** Client latency including retries, for requests that succeeded. */
  e2e99: number
  depth: number
  held: number
  busy: number
  /** Capacity right now, including any slow-dependency multiplier. */
  cap: number
  /** Time-averaged number in system. */
  L: number
  lamOut: number
  /** Mean time in system of what left. */
  W: number
  /** Mean queue wait of what started service. */
  wait: number
  /** Theoretical queue wait for the fresh load (no retries, unbounded FIFO). */
  thWq: number
  spiking: boolean
  slowing: boolean
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

export class Simulation {
  readonly params: Params
  t = 0
  readonly queue = new Deque<Request>()
  /** Callers blocked by the block policy: the backlog lives upstream, where nobody is graphing it. */
  readonly held = new Deque<Request>()
  readonly workers: Worker[] = Array.from({ length: MAX_WORKERS }, () => ({ req: null, start: 0, until: 0, dur: 1 }))
  readonly samples: Sample[] = []
  latest: Sample | null = null
  oom = false
  spikeUntil = -1
  slowUntil = -1
  onFlow: (event: FlowEvent, worker?: number) => void = () => {}

  #random: Random
  #heap = new Heap<SimEvent>()
  #n = 0
  #lastT = 0
  #genEv: Extract<SimEvent, { type: 'gen' }> | null = null
  #bucket = newBucket()
  #buckets: Bucket[] = []
  #nextSample = SAMPLE_SECONDS
  #nextId = 0
  #retryTokens = RETRY_BUDGET_CAP
  #epochWaitSum = 0
  #epochWaitN = 0
  /** When the current epoch began: the last parameter change or disturbance. */
  epochStart = 0

  constructor(params: Partial<Params> = {}, seed = 1, script: readonly ScriptEvent[] = []) {
    this.params = { ...DEFAULTS, ...params }
    this.#random = new Random(seed)
    for (const event of script) this.#heap.push({ t: event.at, type: 'disturb', action: event.action })
    this.#scheduleGen()
  }

  get spiking(): boolean {
    return this.t < this.spikeUntil
  }

  get slowing(): boolean {
    return this.t < this.slowUntil
  }

  /**
   * Mean queue wait since the last change, which settles far better than the 2 s window: near saturation the queue's
   * relaxation time runs to minutes. NaN until something has waited.
   */
  get epochWait(): number {
    return this.#epochWaitN ? this.#epochWaitSum / this.#epochWaitN : Number.NaN
  }

  #newEpoch(): void {
    this.#epochWaitSum = 0
    this.#epochWaitN = 0
    this.epochStart = this.t
  }

  /** Change parameters mid-run, as a control does. */
  set(patch: Partial<Params>): void {
    Object.assign(this.params, patch)
    this.#newEpoch()
    if ('lambda' in patch) this.#rescheduleGen()
    this.#dispatch()
  }

  /** Double the arrival rate for 5 s, or triple service time for 10 s. */
  disturb(action: Disturbance): void {
    this.#newEpoch()
    if (action === 'spike') {
      this.spikeUntil = this.t + 5
      this.#rescheduleGen()
      this.#heap.push({ t: this.spikeUntil, type: 'spikeEnd' })
    } else {
      this.slowUntil = this.t + 10
    }
  }

  /** Run every event up to simulated time `to`. */
  advance(to: number): void {
    const heap = this.#heap
    for (let e = heap.peek(); e && e.t <= to; e = heap.peek()) {
      heap.pop()
      if (e.type === 'gen' && e.dead) continue
      this.#integrate(e.t)
      this.t = e.t
      this.#handle(e)
      if (this.oom) return
    }
    this.#integrate(to)
    this.t = to
  }

  // ---------- Arrivals ----------

  #spikeMult(): number {
    return this.spiking ? 2 : 1
  }

  #slowMult(): number {
    return this.slowing ? 3 : 1
  }

  #scheduleGen(): void {
    const event: Extract<SimEvent, { type: 'gen' }> = {
      t: this.t + this.#random.exponential(this.params.lambda * this.#spikeMult()),
      type: 'gen',
    }
    this.#genEv = event
    this.#heap.push(event)
  }

  #rescheduleGen(): void {
    if (this.#genEv) {
      this.#genEv.dead = true
      this.#genEv = null
    }
    this.#scheduleGen()
  }

  #newRequest(born: number, attempt: number): Request {
    return { id: ++this.#nextId, born, attempt, enq: 0, state: 'new', abandoned: false, retried: false }
  }

  #arrive(r: Request): void {
    const p = this.params
    r.enq = this.t
    r.state = 'new'
    r.abandoned = false
    r.retried = false
    this.#bucket.arr++
    this.#heap.push({ t: this.t + p.timeoutMs / 1000, type: 'timeout', req: r })
    this.onFlow('arrive')
    if (!this.queue.length && !this.held.length) {
      const w = this.#freeWorker()
      if (w) {
        this.#n++
        this.#start(w, r)
        return
      }
    }
    if (p.policy === 'block' && (this.held.length || this.queue.length >= p.cap)) {
      r.state = 'held'
      this.held.push(r)
      this.#n++
      this.#checkOom()
      return
    }
    if (p.policy !== 'unbounded' && this.queue.length >= p.cap) {
      // Rejected at the door: never entered the system, and the client gets a fast error.
      r.state = 'rejected'
      this.#bucket.drops++
      this.onFlow('drop')
      this.#scheduleRetry(r)
      return
    }
    r.state = 'queued'
    this.queue.push(r)
    this.#n++
    this.#checkOom()
  }

  #checkOom(): void {
    if (this.queue.length + this.held.length > OOM_LIMIT) this.oom = true
  }

  #scheduleRetry(r: Request): void {
    const p = this.params
    if (r.retried) return
    r.retried = true
    if (r.attempt >= p.retries) {
      this.#bucket.lost++
      return
    }
    if (p.retryBudget !== null) {
      if (this.#retryTokens < 1) {
        this.#bucket.lost++
        this.#bucket.denied++
        return
      }
      this.#retryTokens -= 1
    }
    const base = (p.backoffMs / 1000) * 2 ** r.attempt
    const delay = p.jitter ? this.#random.next() * base : base
    this.#heap.push({ t: this.t + delay, type: 'retry', req: this.#newRequest(r.born, r.attempt + 1) })
    this.#bucket.retries++
  }

  // ---------- Service ----------

  #serviceTime(): number {
    const p = this.params
    const s = p.svcMs / 1000
    let x: number
    if (p.variability === 'low') x = Math.max(s * 0.2, s * (1 + 0.25 * this.#random.gaussian()))
    else if (p.variability === 'heavy') {
      // Lognormal with the requested mean and a coefficient of variation of 3.
      const s2 = Math.log(10)
      x = Math.exp(Math.log(s) - s2 / 2 + Math.sqrt(s2) * this.#random.gaussian())
    } else x = this.#random.exponential(1 / s)
    return x * this.#slowMult()
  }

  #freeWorker(): Worker | null {
    for (let i = 0; i < this.params.workers; i++) if (!this.workers[i].req) return this.workers[i]
    return null
  }

  #start(w: Worker, r: Request): void {
    r.state = 'service'
    w.req = r
    w.start = this.t
    w.dur = this.#serviceTime()
    w.until = this.t + w.dur
    this.#bucket.waitSum += this.t - r.enq
    this.#bucket.waitN++
    this.#epochWaitSum += this.t - r.enq
    this.#epochWaitN++
    this.#heap.push({ t: w.until, type: 'done', worker: w })
  }

  #leave(r: Request): void {
    this.#n--
    this.#bucket.leave++
    this.#bucket.soj += this.t - r.enq
  }

  #finish(r: Request, workerIndex: number): void {
    r.state = 'done'
    this.#leave(r)
    const b = this.#bucket
    b.comp++
    b.lat.push(this.t - r.enq)
    if (r.abandoned) {
      b.wasted++
      this.onFlow('waste', workerIndex)
    } else {
      b.good++
      b.e2e.push(this.t - r.born)
      this.onFlow('ok', workerIndex)
    }
  }

  #skip(r: Request): void {
    r.state = 'skipped'
    this.#leave(r)
    this.#bucket.expired++
    this.onFlow('skip')
  }

  #nextFromQueue(): Request | null {
    const p = this.params
    const q = this.queue
    // With expiry skipping on, purge dead work from the front too, so LIFO cannot strand zombies at the bottom.
    if (p.dropExpired) {
      while (q.length && q.get(0).abandoned) this.#skip(q.shift() as Request)
    }
    while (q.length) {
      const c = (p.discipline === 'lifo' ? q.pop() : q.shift()) as Request
      if (p.dropExpired && c.abandoned) {
        this.#skip(c)
        continue
      }
      if (p.policy === 'codel' && this.t - c.enq > p.ageMs / 1000) {
        c.state = 'rejected'
        this.#leave(c)
        this.#bucket.drops++
        this.onFlow('drop')
        this.#scheduleRetry(c)
        continue
      }
      return c
    }
    return null
  }

  #refill(): void {
    const p = this.params
    while (this.held.length && (p.policy !== 'block' || this.queue.length < p.cap)) {
      const r = this.held.shift() as Request
      r.state = 'queued'
      this.queue.push(r)
    }
  }

  #dispatch(): void {
    this.#refill()
    for (let i = 0; i < this.params.workers; i++) {
      const w = this.workers[i]
      if (w.req) continue
      const r = this.#nextFromQueue()
      if (!r) break
      this.#start(w, r)
      this.#refill()
    }
  }

  #handle(e: SimEvent): void {
    switch (e.type) {
      case 'gen':
        this.#genEv = null
        this.#bucket.fresh++
        if (this.params.retryBudget !== null)
          this.#retryTokens = Math.min(RETRY_BUDGET_CAP, this.#retryTokens + this.params.retryBudget)
        this.#arrive(this.#newRequest(this.t, 0))
        this.#scheduleGen()
        break
      case 'retry':
        this.#arrive(e.req)
        break
      case 'timeout': {
        const r = e.req
        if (r.state === 'done' || r.state === 'rejected' || r.state === 'skipped' || r.abandoned) break
        r.abandoned = true
        this.#bucket.timeouts++
        this.#scheduleRetry(r)
        break
      }
      case 'done': {
        const w = e.worker
        const r = w.req as Request
        w.req = null
        this.#finish(r, this.workers.indexOf(w))
        this.#dispatch()
        break
      }
      case 'spikeEnd':
        this.#rescheduleGen()
        break
      case 'disturb':
        this.disturb(e.action)
        break
    }
  }

  // ---------- Metrics ----------

  #integrate(t: number): void {
    while (this.#nextSample <= t) {
      this.#bucket.area += this.#n * (this.#nextSample - this.#lastT)
      this.#lastT = this.#nextSample
      this.#takeSample(this.#nextSample)
      this.#nextSample += SAMPLE_SECONDS
    }
    this.#bucket.area += this.#n * (t - this.#lastT)
    this.#lastT = t
  }

  #takeSample(ts: number): void {
    const p = this.params
    this.#buckets.push(this.#bucket)
    if (this.#buckets.length > WINDOW_BUCKETS) this.#buckets.shift()
    this.#bucket = newBucket()
    const w = this.#buckets.length * SAMPLE_SECONDS
    const s = newBucket()
    const lat: number[] = []
    const e2e: number[] = []
    for (const b of this.#buckets) {
      s.arr += b.arr
      s.fresh += b.fresh
      s.good += b.good
      s.drops += b.drops
      s.timeouts += b.timeouts
      s.wasted += b.wasted
      s.expired += b.expired
      s.retries += b.retries
      s.lost += b.lost
      s.denied += b.denied
      s.comp += b.comp
      s.area += b.area
      s.leave += b.leave
      s.soj += b.soj
      s.waitSum += b.waitSum
      s.waitN += b.waitN
      lat.push(...b.lat)
      e2e.push(...b.e2e)
    }
    lat.sort((x, y) => x - y)
    e2e.sort((x, y) => x - y)
    let busy = 0
    for (const worker of this.workers) if (worker.req) busy++
    const m: Sample = {
      t: ts,
      offered: s.arr / w,
      fresh: s.fresh / w,
      good: s.good / w,
      shed: (s.drops + s.expired) / w,
      drops: s.drops / w,
      expired: s.expired / w,
      timeouts: s.timeouts / w,
      retries: s.retries / w,
      lost: s.lost / w,
      denied: s.denied / w,
      wastedPct: s.comp ? s.wasted / s.comp : 0,
      p50: percentile(lat, 0.5),
      p99: percentile(lat, 0.99),
      e2e99: percentile(e2e, 0.99),
      depth: this.queue.length,
      held: this.held.length,
      busy,
      cap: capacity(p) / this.#slowMult(),
      L: s.area / w,
      lamOut: s.leave / w,
      W: s.leave ? s.soj / s.leave : Number.NaN,
      wait: s.waitN ? s.waitSum / s.waitN : Number.NaN,
      thWq: theoreticalWait(p),
      spiking: this.spiking,
      slowing: this.slowing,
    }
    this.samples.push(m)
    if (this.samples.length > HISTORY_SAMPLES) this.samples.shift()
    this.latest = m
  }
}

export type HealthId =
  | 'healthy'
  | 'knee'
  | 'overloaded'
  | 'shedding'
  | 'collapsed'
  | 'recovering'
  | 'metastable'
  | 'oom'

export interface Health {
  id: HealthId
  label: string
  tone: 'good' | 'warn' | 'crit'
}

/** How far back the trend check looks, in samples (4 s). */
const TREND_SAMPLES = 16

/**
 * The state pill. Metastable is the one that matters: goodput has collapsed although nothing is disturbing the system,
 * the fresh load alone is within capacity, and the queue is not draining. A collapse whose queue is shrinking is a
 * backlog clearing (recovering), not a stuck system. Both are heuristics, and the demos say so.
 */
export function health(sim: Simulation, m: Sample): Health {
  const p = sim.params
  const rho = (p.lambda * (m.spiking ? 2 : 1)) / m.cap
  const collapsed = m.fresh > 1 && m.good < 0.5 * m.fresh
  if (sim.oom) return { id: 'oom', label: 'OUT OF MEMORY', tone: 'crit' }
  // Judge the trend only once a full window has passed since the last disturbance ended.
  const settled = m.t - Math.max(sim.spikeUntil, sim.slowUntil) >= TREND_SAMPLES * SAMPLE_SECONDS
  if (collapsed && settled && p.lambda < m.cap) {
    const earlier = sim.samples[sim.samples.length - 1 - TREND_SAMPLES]
    const backlog = (s: Sample) => s.depth + s.held
    if (earlier && backlog(m) < 0.97 * backlog(earlier)) return { id: 'recovering', label: 'RECOVERING', tone: 'warn' }
    return { id: 'metastable', label: 'METASTABLE', tone: 'crit' }
  }
  if (collapsed) return { id: 'collapsed', label: 'COLLAPSED', tone: 'crit' }
  if (m.offered > m.cap * 1.02 && m.shed > 0.02 * m.offered) return { id: 'shedding', label: 'SHEDDING', tone: 'warn' }
  if (m.offered > m.cap * 1.02 || m.held > 0) return { id: 'overloaded', label: 'OVERLOADED', tone: 'crit' }
  if (rho > 0.9) return { id: 'knee', label: 'AT THE KNEE', tone: 'warn' }
  return { id: 'healthy', label: 'HEALTHY', tone: 'good' }
}
