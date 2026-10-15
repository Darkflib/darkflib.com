// The controls, readouts, and held-constant lines demos choose from. Pure: labels, ranges, and formatting, with no
// React, so a demo definition stays data and the page renders whatever it lists.
import type { ControlId, HeldId, ReadoutId } from './definition.ts'
import { capacity, type Params, utilisation, type Variability } from './engine/params.ts'
import { type Health, health, type Sample, type Simulation } from './engine/simulation.ts'

// ---------- Formatting ----------

export const fmtSeconds = (s: number) =>
  !Number.isFinite(s)
    ? '—'
    : s < 1
      ? `${Math.round(s * 1000)} MS`
      : s < 100
        ? `${s.toFixed(s < 10 ? 2 : 1)} S`
        : `${Math.round(s)} S`
export const fmtRate = (r: number) => (!Number.isFinite(r) ? '—' : r < 10 ? r.toFixed(1) : Math.round(r).toString())
export const fmtCount = (n: number) =>
  !Number.isFinite(n) ? '—' : n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-GB')
export const fmtPercent = (x: number) => `${Math.round(x * 100)}%`

// ---------- Controls ----------

interface ControlBase {
  id: ControlId
  label: string
  /** What moving it means, in a sentence. */
  help: string
}

export interface RangeControl extends ControlBase {
  kind: 'range'
  min: number
  max: number
  step: number
  get: (p: Params) => number
  patch: (value: number, p: Params) => Partial<Params>
  format: (value: number) => string
}

export interface SelectControl extends ControlBase {
  kind: 'select'
  options: readonly { value: string; label: string }[]
  get: (p: Params) => string
  patch: (value: string, p: Params) => Partial<Params>
}

export type Control = RangeControl | SelectControl

const VARIABILITY_LABELS: Record<Variability, string> = {
  low: 'TIGHT (CV 0.25)',
  exp: 'EXPONENTIAL (CV 1)',
  heavy: 'HEAVY TAIL (CV 3)',
}

export const CONTROLS: Record<ControlId, Control> = {
  utilisation: {
    id: 'utilisation',
    kind: 'range',
    label: 'UTILISATION',
    help: 'Arrival rate as a share of what the workers can serve.',
    min: 0.3,
    max: 0.98,
    step: 0.01,
    get: utilisation,
    patch: (value, p) => ({ lambda: value * capacity(p) }),
    format: fmtPercent,
  },
  variability: {
    id: 'variability',
    kind: 'select',
    label: 'SERVICE TIME SHAPE',
    help: 'Same mean work per request; how much individual requests vary.',
    options: (Object.keys(VARIABILITY_LABELS) as Variability[]).map((value) => ({
      value,
      label: VARIABILITY_LABELS[value],
    })),
    get: (p) => p.variability,
    patch: (value) => ({ variability: value as Variability }),
  },
  retries: {
    id: 'retries',
    kind: 'range',
    label: 'RETRIES PER REQUEST',
    help: 'How many times a client tries again after a timeout or rejection.',
    min: 0,
    max: 3,
    step: 1,
    get: (p) => p.retries,
    patch: (value) => ({ retries: value }),
    format: (value) => String(value),
  },
  retryBudget: {
    id: 'retryBudget',
    kind: 'select',
    label: 'RETRY BUDGET',
    help: 'Retries allowed as a share of all requests, across the client.',
    options: [
      { value: 'none', label: 'NONE' },
      { value: '0.5', label: '50% OF REQUESTS' },
      { value: '0.2', label: '20% OF REQUESTS' },
      { value: '0.1', label: '10% OF REQUESTS' },
    ],
    get: (p) => (p.retryBudget === null ? 'none' : String(p.retryBudget)),
    patch: (value) => ({ retryBudget: value === 'none' ? null : Number(value) }),
  },
}

// ---------- Held constant ----------

export const HELD: Record<HeldId, (p: Params) => string> = {
  utilisation: (p) => `${fmtPercent(utilisation(p))} busy before retries`,
  workers: (p) => `${p.workers} workers`,
  service: (p) => `${p.svcMs} ms mean service, ${VARIABILITY_LABELS[p.variability].toLowerCase()}`,
  queue: (p) =>
    p.policy === 'unbounded'
      ? `unbounded ${p.discipline.toUpperCase()} queue`
      : `${p.policy} queue of ${p.cap}, ${p.discipline.toUpperCase()}`,
  timeout: (p) => (p.timeoutMs >= 3_600_000 ? 'no client timeout' : `${p.timeoutMs} ms client timeout`),
  retries: (p) => (p.retries === 0 ? 'no retries' : `${p.retries} retries`),
  backoff: (p) => `${p.backoffMs} ms exponential backoff, ${p.jitter ? 'jittered' : 'no jitter'}`,
}

// ---------- Readouts ----------

export interface Reading {
  label: string
  value: string
  sub: string
  /** Shown as a state pill rather than a number. */
  tone?: Health['tone']
}

type Readout = (sim: Simulation, m: Sample) => Reading

export const READOUTS: Record<ReadoutId, Readout> = {
  health: (sim, m) => {
    const h = health(sim, m)
    const rho = (sim.params.lambda * (m.spiking ? 2 : 1)) / m.cap
    return {
      label: 'STATE',
      value: h.label,
      sub: `ρ ${rho.toFixed(2)} · ${(m.offered / m.cap).toFixed(2)} WITH RETRIES`,
      tone: h.tone,
    }
  },
  utilisation: (sim, m) => ({
    label: 'WORKERS BUSY',
    value: `${m.busy} / ${sim.params.workers}`,
    sub: `ρ ${(sim.params.lambda / m.cap).toFixed(2)}`,
  }),
  queueWait: (sim, m) => ({
    label: 'MEAN QUEUE WAIT',
    value: fmtSeconds(sim.epochWait),
    sub: Number.isFinite(m.thWq)
      ? `THEORY ${fmtSeconds(m.thWq)} · OVER ${Math.round(sim.t - sim.epochStart)} S`
      : 'THEORY: NO STEADY STATE',
  }),
  serverLatency: (_sim, m) => ({
    label: 'SERVER LATENCY',
    value: `${fmtSeconds(m.p50)} / ${fmtSeconds(m.p99)}`,
    sub: 'P50 / P99',
  }),
  clientP99: (_sim, m) => ({
    label: 'CLIENT P99',
    value: fmtSeconds(m.e2e99),
    sub: m.lost > 0 ? `${fmtRate(m.lost)}/S GAVE UP` : 'INCLUDING RETRIES',
  }),
  goodput: (_sim, m) => ({
    label: 'GOODPUT',
    value: `${fmtRate(m.good)}/S`,
    sub: `OF ${fmtRate(m.offered)}/S OFFERED`,
  }),
  retries: (_sim, m) => ({
    label: 'RETRIES',
    value: `${fmtRate(m.retries)}/S`,
    sub: m.denied > 0 ? `${fmtRate(m.denied)}/S REFUSED BY BUDGET` : `${fmtRate(m.timeouts)}/S TIMEOUTS`,
  }),
  wasted: (_sim, m) => ({ label: 'WASTED WORK', value: fmtPercent(m.wastedPct), sub: 'SERVED AFTER TIMEOUT' }),
  queueDepth: (sim, m) => ({
    label: 'QUEUE',
    value: fmtCount(m.depth),
    sub: sim.oom ? 'OUT OF MEMORY' : `MEAN WAIT ${fmtSeconds(m.wait)}`,
  }),
  littles: (_sim, m) => {
    const lw = m.lamOut * m.W
    const steady = Number.isFinite(m.W) && m.L > 0 ? Math.abs(m.L - lw) / m.L < 0.15 : true
    return {
      label: "LITTLE'S LAW",
      value: `${fmtCount(m.L)} vs ${fmtCount(lw)}`,
      sub: `L vs λW · ${steady ? 'STEADY' : 'NOT STEADY'}`,
    }
  },
}
