// Client-side resilience primitives for the Fault Lab status client. The service worker only breaks things; everything
// here is the application's own recovery, exactly as it would behave against a genuinely failing origin.

export type Outcome =
  | { kind: 'ok'; latencyMs: number; body: unknown }
  | { kind: 'http'; latencyMs: number; status: number; retryAfterMs: number | null }
  | { kind: 'timeout'; latencyMs: number }
  | { kind: 'network'; latencyMs: number }

/** One attempt: a timed-out, failed, or non-2xx response is an outcome, never an exception. */
export async function attempt(url: string, timeoutMs: number): Promise<Outcome> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      return {
        kind: 'http',
        latencyMs: elapsed(),
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
      }
    }
    return { kind: 'ok', latencyMs: elapsed(), body: await response.json() }
  } catch (error) {
    // AbortSignal.timeout() surfaces as TimeoutError (Chromium, Firefox) or AbortError (WebKit).
    const name = error instanceof Error ? error.name : ''
    return name === 'TimeoutError' || name === 'AbortError'
      ? { kind: 'timeout', latencyMs: elapsed() }
      : { kind: 'network', latencyMs: elapsed() }
  }
}

export function describeOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `200 in ${outcome.latencyMs} ms`
    case 'http':
      return `HTTP ${outcome.status} in ${outcome.latencyMs} ms`
    case 'timeout':
      return `timeout after ${outcome.latencyMs} ms`
    case 'network':
      return 'network error'
  }
}

/** Worth retrying: transport failures, 429, and 5xx. Other client errors will not change on a retry. */
export function isRetryable(outcome: Outcome): boolean {
  if (outcome.kind === 'timeout' || outcome.kind === 'network') return true
  return outcome.kind === 'http' && (outcome.status === 429 || outcome.status >= 500)
}

/** Full jitter: uniformly random up to min(cap, base * 2^retry), so clients recovering together do not stampede. */
export function backoffDelay(retry: number, baseMs: number, capMs: number, random = Math.random): number {
  return Math.round(random() * Math.min(capMs, baseMs * 2 ** retry))
}

/** Retry-After as delay-seconds or an HTTP date; null if absent or unparseable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || value.trim() === '') return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Counts consecutive failed calls. At the threshold it opens and refuses calls for a cool-off, then allows a single
 * trial (half-open): success closes it, failure opens it again.
 */
export class CircuitBreaker {
  state: CircuitState = 'closed'
  failures = 0
  openUntil = 0

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
  ) {}

  /** Whether a call may go ahead now. Moves an open circuit whose cool-off has passed to half-open. */
  allow(now: number): boolean {
    if (this.state === 'open' && now >= this.openUntil) this.state = 'half-open'
    return this.state !== 'open'
  }

  success() {
    this.state = 'closed'
    this.failures = 0
  }

  /** Record a failed call; `openForMs` forces the circuit open for a server-requested back-off. */
  failure(now: number, openForMs?: number) {
    this.failures += 1
    if (openForMs !== undefined || this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open'
      this.openUntil = now + (openForMs ?? this.openMs)
    }
  }
}
