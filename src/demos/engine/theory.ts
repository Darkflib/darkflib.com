import { type Params, SERVICE_CS2 } from './params.ts'

/** Erlang C: probability an arrival waits, for c servers at offered load a (in erlangs). */
export function erlangC(c: number, a: number): number {
  if (a >= c) return 1
  let term = 1
  let sum = 1
  for (let k = 1; k < c; k++) {
    term *= a / k
    sum += term
  }
  term *= a / c
  const top = (term * c) / (c - a)
  return top / (sum + top)
}

/**
 * Mean queue wait in seconds for an unbounded FIFO queue with no retries: the Allen-Cunneen approximation for
 * M/G/c, exact for M/M/c. Infinity at or past saturation, where there is no steady state.
 */
export function theoreticalWait(p: Pick<Params, 'lambda' | 'workers' | 'svcMs' | 'variability'>): number {
  const s = p.svcMs / 1000
  const a = p.lambda * s
  if (a >= p.workers) return Number.POSITIVE_INFINITY
  return (erlangC(p.workers, a) / (p.workers / s - p.lambda)) * ((1 + SERVICE_CS2[p.variability]) / 2)
}
