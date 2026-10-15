/**
 * Seeded randomness for the simulation, so a preset plays out the same way on every run (and in tests). mulberry32:
 * small, fast, and plenty for queueing variates; not for anything cryptographic.
 */
export class Random {
  #state: number

  constructor(seed: number) {
    this.#state = seed >>> 0
  }

  /** Uniform on [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0
    let t = this.#state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Exponential with the given rate (mean 1/rate). */
  exponential(rate: number): number {
    return -Math.log(1 - this.next()) / rate
  }

  /** Standard normal, by Box-Muller. */
  gaussian(): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
