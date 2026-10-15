// Every demo page, in index order: the simulated concepts and the live circuit breaker. Pure data, read by the index
// page, vite.config.ts (one HTML input per page), and scripts/pages.ts (which writes those HTML files).
import { CONCEPTS } from './concepts/index.ts'

export interface CatalogueEntry {
  slug: string
  name: string
  title: string
  question: string
  summary: string
  tags: readonly string[]
  /** Live demos act on real requests; simulated ones run the engine. */
  kind: 'live' | 'simulated'
  takeaways: readonly { title: string; body: string }[]
}

export const CIRCUIT_BREAKER: CatalogueEntry = {
  slug: 'circuit-breaker',
  name: 'Circuit breaker',
  title: 'CIRCUIT BREAKER',
  question: 'What should a client do when the service it depends on starts failing?',
  summary:
    "Break this page's own API calls from inside your browser, and watch the client retry with backoff, trip its circuit breaker, and fail over to a secondary.",
  tags: ['RETRIES', 'CIRCUIT BREAKER', 'FAILOVER', 'SERVICE WORKER'],
  kind: 'live',
  takeaways: [
    {
      title: 'Real requests, local faults',
      body: "Faults are injected by a service worker into this tab's requests only. The origins stay healthy for everyone else, and the client recovers on its own, as it would from a real outage.",
    },
  ],
}

const SIMULATED: readonly CatalogueEntry[] = CONCEPTS.map((demo) => ({ ...demo, kind: 'simulated' as const }))
const BY_SLUG = new Map([...SIMULATED, CIRCUIT_BREAKER].map((entry) => [entry.slug, entry]))

export interface DemoGroup {
  id: string
  title: string
  /** What the demos in the group have in common, in a sentence. */
  blurb: string
  demos: readonly CatalogueEntry[]
}

const group = (id: string, title: string, blurb: string, slugs: readonly string[]): DemoGroup => ({
  id,
  title,
  blurb,
  demos: slugs.map((slug) => {
    const entry = BY_SLUG.get(slug)
    if (!entry) throw new Error(`No demo with slug "${slug}"`)
    return entry
  }),
})

/** The index's sections, in order. Every demo belongs to exactly one (tests/unit checks). */
export const DEMO_GROUPS: readonly DemoGroup[] = [
  group('queueing', 'QUEUEING & CAPACITY', 'How load turns into waiting, and where the excess goes.', [
    'queueing-knee',
    'overload',
  ]),
  group('retries', 'RETRIES & RECOVERY', 'How retries turn a blip into an outage, and how to stop them.', [
    'retry-storms',
    'breaking-the-loop',
  ]),
  group('failover', 'FAILOVER', 'What a client does when the service it depends on fails. Live, on real requests.', [
    'circuit-breaker',
  ]),
  // Last: it assumes the concepts the others teach.
  group('sandbox', 'BUILD YOUR OWN', 'Every control at once, for when you know what you are looking for.', ['sandbox']),
]

/** Every demo, in index order. */
export const CATALOGUE: readonly CatalogueEntry[] = DEMO_GROUPS.flatMap((g) => g.demos)

export const demoPath = (slug: string) => `/demos/${slug}/`
