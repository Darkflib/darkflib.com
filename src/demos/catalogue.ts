// Every demo page, in index order: the simulated concepts and the live circuit breaker. Pure data, read by the index
// page, vite.config.ts (one HTML input per page), and scripts/demo-pages.ts (which writes those HTML files).
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

export const CATALOGUE: readonly CatalogueEntry[] = [
  ...CONCEPTS.map((demo) => ({ ...demo, kind: 'simulated' as const })),
  CIRCUIT_BREAKER,
]

export const demoPath = (slug: string) => `/demos/${slug}/`
