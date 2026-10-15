// What a demo is: one concept, a handful of exposed controls, and presets that each tell part of the story. Pure data
// (no React), so tests/unit can run every preset headless and check it ends the way its description says.
import type { Params } from './engine/params.ts'
import type { Disturbance, HealthId, ScriptEvent } from './engine/simulation.ts'

export type ControlId =
  | 'utilisation'
  | 'load'
  | 'workers'
  | 'serviceTime'
  | 'variability'
  | 'queuePolicy'
  | 'admission'
  | 'queueLimit'
  | 'queueAge'
  | 'shedByAge'
  | 'lifo'
  | 'dropExpired'
  | 'timeout'
  | 'retries'
  | 'backoff'
  | 'jitter'
  | 'retryBudget'
export type ReadoutId =
  | 'health'
  | 'utilisation'
  | 'queueWait'
  | 'serverLatency'
  | 'clientP99'
  | 'goodput'
  | 'retries'
  | 'wasted'
  | 'shed'
  | 'queueDepth'
  | 'blocked'
  | 'littles'
export type ChartId = 'throughput' | 'depth' | 'backlog' | 'latency'
/** Parameters a demo may list as held constant; each has a describer in the registry. */
export type HeldId =
  | 'utilisation'
  | 'workers'
  | 'service'
  | 'queue'
  | 'discipline'
  | 'shedding'
  | 'timeout'
  | 'retries'
  | 'backoff'

/** A state the run must be in at a given time, for tests and for the reader's expectations. */
export interface Expectation {
  at: number
  health: readonly HealthId[]
}

export interface Preset {
  id: string
  label: string
  /** One sentence: what to watch for. */
  description: string
  params: Partial<Params>
  script?: readonly ScriptEvent[]
  /** What the run shows, checked by tests/unit for the preset's seed. */
  expect?: readonly Expectation[]
}

export interface DemoDefinition {
  /** URL segment under /demos/, and the key for its page. */
  slug: string
  /** Plain name, for page titles and links. */
  name: string
  /** Display title, in the site's caps. */
  title: string
  /** The question the demo answers, as a reader would ask it. */
  question: string
  /** One or two sentences for the index and the page description. */
  summary: string
  tags: readonly string[]
  /** Engine parameters for everything the demo does not expose. Presets apply on top. */
  base: Partial<Params>
  controls: readonly ControlId[]
  /** Disturbance buttons. */
  actions: readonly Disturbance[]
  presets: readonly Preset[]
  readouts: readonly ReadoutId[]
  charts: readonly ChartId[]
  /** Shown as "held constant", so the limits are visible rather than hidden. Empty when every parameter is a control. */
  held: readonly HeldId[]
  /** A visual of its own, beside the pipeline. */
  visual?: 'knee-curve'
  /** What to take away, in order. */
  takeaways: readonly { title: string; body: string }[]
}

/** Every preset runs from the same seed, so it tells the same story each time. */
export const DEMO_SEED = 1
