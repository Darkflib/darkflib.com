// The SLO burn-rate demo's model: one day of traffic at a minute's resolution, an error rate you draw (or a preset
// draws), and three alerting rules evaluated over it. Pure and seeded, with no DOM, so tests/unit can check each
// preset's verdicts. The rules follow the alerting chapter of Google's SRE workbook.
import { Random } from '../engine/random.ts'

/** Minutes in the day the demo shows. */
export const DAY = 1440
/** Quiet minutes simulated before midnight, so the 6-hour window is full from the first minute. */
export const HISTORY = 360
/** Steady traffic: enough that a 5-minute window holds 25,000 requests, so noise alone rarely crosses a line. */
export const REQUESTS_PER_MINUTE = 5000
/** The error rate a healthy service runs at. */
export const BASELINE = 0.0002
/** The lowest error rate the chart and the pen go to. */
export const FLOOR = 0.0001
/** The SLO's own window, which the error budget is spread over. */
export const SLO_DAYS = 30
/** Share of the month's budget an incident must spend for a page to be worth it. */
export const WORTH_A_PAGE = 0.05

export const SLO_TARGETS = [0.99, 0.995, 0.999, 0.9995, 0.9999] as const
export const THRESHOLDS = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1] as const
/** The fixed-threshold rule's window. */
export const THRESHOLD_WINDOW = 5

export interface Settings {
  /** Share of requests that must succeed over the SLO window. */
  slo: number
  /** Error ratio over the last THRESHOLD_WINDOW minutes that fires the fixed-threshold rule. */
  threshold: number
}

export const DEFAULT_SETTINGS: Settings = { slo: 0.999, threshold: 0.01 }

/**
 * The workbook's two paging tiers. Each fires when both its long window and its short one (a twelfth as long) burn the
 * budget at least `burn` times faster than the SLO allows: 14.4x for an hour spends 2% of a 30-day budget, and 6x for
 * six hours spends 5%. The short window is what lets the alert clear soon after the errors stop.
 */
export const TIERS = [
  { id: 'fast', long: 60, short: 5, burn: 14.4 },
  { id: 'slow', long: 360, short: 30, burn: 6 },
] as const
export type TierId = (typeof TIERS)[number]['id']

export type RuleId = 'threshold' | 'single' | 'multi'
export const RULE_IDS: readonly RuleId[] = ['threshold', 'single', 'multi']

/** Window lengths the page reports at the cursor, in minutes. */
export const WINDOWS = [5, 30, 60, 360] as const

export type Curve = Float64Array

export const flatCurve = (rate = BASELINE): Curve => new Float64Array(DAY).fill(rate)

/** Set minutes [from, to) of a curve to a rate. */
export function fill(curve: Curve, from: number, to: number, rate: number): Curve {
  for (let m = Math.max(0, from); m < Math.min(DAY, to); m++) curve[m] = rate
  return curve
}

/**
 * Fixed noise for each minute, drawn once from the seed: a uniform for small counts and a normal for large ones.
 * Errors are then a deterministic, monotone function of the drawn rate, so redrawing one minute moves only that minute,
 * and a curve always gives the same day.
 */
export interface Noise {
  u: Float64Array
  z: Float64Array
}

export function noise(seed: number): Noise {
  const random = new Random(seed)
  const n = HISTORY + DAY
  const u = new Float64Array(n)
  const z = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    u[i] = random.next()
    z[i] = random.gaussian()
  }
  return { u, z }
}

/** Past this many expected errors a minute, the normal approximation is close enough. */
const POISSON_MAX = 30

/**
 * Errors in a minute of n requests failing at rate p. Few expected: Poisson, by inverting its distribution at the
 * minute's uniform. Many: the binomial's normal approximation, at the minute's normal.
 */
function errorsFor(p: number, u: number, z: number, n = REQUESTS_PER_MINUTE): number {
  const mean = n * p
  if (mean > POISSON_MAX) return Math.min(n, Math.max(0, Math.round(mean + z * Math.sqrt(mean * (1 - p)))))
  let k = 0
  let pmf = Math.exp(-mean)
  let cdf = pmf
  while (cdf < u && k < n) {
    k++
    pmf *= mean / k
    cdf += pmf
  }
  return k
}

export interface Day {
  settings: Settings
  curve: Curve
  /** Errors per minute, history first: index HISTORY is midnight. */
  errors: Float64Array
  /** Running totals of errors, one longer than errors, for window sums. */
  prefix: Float64Array
  /** Allowed error ratio: 1 - slo. */
  budgetRatio: number
  /** Share of the month's error budget spent by the end of each minute of the day. */
  spent: Float64Array
  /** Whether each rule is firing at the end of each minute. */
  firing: Record<RuleId, Uint8Array>
  /** Each paging tier on its own, for the multi-window rule's breakdown. */
  tiers: Record<TierId, Uint8Array>
  /** The incident's first and last minutes (end exclusive), or null when the curve never leaves baseline. */
  incident: { start: number; end: number } | null
}

/** Error ratio over the `minutes` minutes ending with minute m of the day. */
export function ratio(day: Day, m: number, minutes: number): number {
  const end = HISTORY + m + 1
  return (day.prefix[end] - day.prefix[end - minutes]) / (minutes * REQUESTS_PER_MINUTE)
}

/** How many times faster than the SLO allows the window spent the budget. */
export const burnRate = (day: Day, m: number, minutes: number) => ratio(day, m, minutes) / day.budgetRatio

export function tierFiring(day: Day, m: number, tier: (typeof TIERS)[number]): boolean {
  return burnRate(day, m, tier.long) >= tier.burn && burnRate(day, m, tier.short) >= tier.burn
}

export function simulate(curve: Curve, settings: Settings, { u, z }: Noise): Day {
  const errors = new Float64Array(HISTORY + DAY)
  for (let i = 0; i < errors.length; i++) errors[i] = errorsFor(i < HISTORY ? BASELINE : curve[i - HISTORY], u[i], z[i])
  const prefix = new Float64Array(errors.length + 1)
  for (let i = 0; i < errors.length; i++) prefix[i + 1] = prefix[i] + errors[i]

  const budgetRatio = 1 - settings.slo
  const monthBudget = budgetRatio * REQUESTS_PER_MINUTE * SLO_DAYS * DAY
  const spent = new Float64Array(DAY)
  const firing = { threshold: new Uint8Array(DAY), single: new Uint8Array(DAY), multi: new Uint8Array(DAY) }
  const tiers = { fast: new Uint8Array(DAY), slow: new Uint8Array(DAY) }

  let start = -1
  let end = -1
  for (let m = 0; m < DAY; m++) {
    if (curve[m] > BASELINE * 1.5) {
      if (start < 0) start = m
      end = m + 1
    }
  }

  const day: Day = {
    settings,
    curve,
    errors,
    prefix,
    budgetRatio,
    spent,
    firing,
    tiers,
    incident: start < 0 ? null : { start, end },
  }
  for (let m = 0; m < DAY; m++) {
    spent[m] = (prefix[HISTORY + m + 1] - prefix[HISTORY]) / monthBudget
    firing.threshold[m] = ratio(day, m, THRESHOLD_WINDOW) > settings.threshold ? 1 : 0
    // The single-window rule is the fast tier's long window alone: no short window to clear it.
    firing.single[m] = burnRate(day, m, TIERS[0].long) >= TIERS[0].burn ? 1 : 0
    tiers.fast[m] = tierFiring(day, m, TIERS[0]) ? 1 : 0
    tiers.slow[m] = tierFiring(day, m, TIERS[1]) ? 1 : 0
    firing.multi[m] = tiers.fast[m] || tiers.slow[m]
  }
  return day
}

export type Verdict = 'caught' | 'noise' | 'missed' | 'quiet' | 'flapping'

export interface RuleSummary {
  /** Times the rule started firing: each one is a page. */
  pages: number
  /** Minute of the day it first fired, or null. */
  first: number | null
  /** Minutes spent firing. */
  minutes: number
  /** Minutes it kept firing after the incident ended; null if it never fired, or it was still firing at midnight. */
  clearsAfter: number | null
  stillFiring: boolean
  verdict: Verdict
}

/** More pages than this for one incident is flapping, not alerting. */
export const FLAP_PAGES = 3

export function summarise(day: Day, rule: RuleId): RuleSummary {
  const f = day.firing[rule]
  let pages = 0
  let first: number | null = null
  let minutes = 0
  let last = -1
  for (let m = 0; m < DAY; m++) {
    if (!f[m]) continue
    minutes++
    if (m === 0 || !f[m - 1]) pages++
    if (first === null) first = m
    last = m
  }
  const stillFiring = f[DAY - 1] === 1
  const clearsAfter = first === null || stillFiring || !day.incident ? null : Math.max(0, last + 1 - day.incident.end)
  const worthIt = incidentSpend(day) >= WORTH_A_PAGE
  const verdict: Verdict =
    pages > FLAP_PAGES ? 'flapping' : pages > 0 ? (worthIt ? 'caught' : 'noise') : worthIt ? 'missed' : 'quiet'
  return { pages, first, minutes, clearsAfter, stillFiring, verdict }
}

/** Share of the month's budget the incident itself spent, net of what a healthy day's errors spend. */
export function incidentSpend(day: Day): number {
  const healthy = BASELINE / (day.budgetRatio * SLO_DAYS)
  return Math.max(0, day.spent[DAY - 1] - healthy)
}
