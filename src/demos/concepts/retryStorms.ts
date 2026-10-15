import type { DemoDefinition } from '../definition.ts'

const SPIKE = [{ at: 6, action: 'spike' }] as const

export const retryStorms: DemoDefinition = {
  slug: 'retry-storms',
  name: 'Retry storms',
  title: 'RETRY STORMS',
  question: 'Why does the service stay down after the spike that broke it has gone?',
  summary:
    'A five-second traffic spike at 80% load. Without retries the service recovers; with them it never does, until a retry budget caps how much load retries can add.',
  tags: ['RETRIES', 'METASTABILITY', 'RETRY BUDGETS', 'OVERLOAD'],
  base: {
    lambda: 64,
    workers: 8,
    svcMs: 100,
    variability: 'exp',
    policy: 'unbounded',
    discipline: 'fifo',
    timeoutMs: 600,
    backoffMs: 50,
    jitter: false,
    dropExpired: false,
  },
  controls: ['retries', 'retryBudget'],
  actions: ['spike'],
  presets: [
    {
      id: 'storm',
      label: 'RETRY STORM',
      description: 'Three retries per request, no budget. The spike ends at 11 s; the outage does not.',
      params: { retries: 3, retryBudget: null },
      script: SPIKE,
      expect: [
        { at: 4, health: ['healthy'] },
        { at: 60, health: ['metastable'] },
      ],
    },
    {
      id: 'no-retries',
      label: 'NO RETRIES',
      description: 'The same spike with retries off. The backlog drains and the service comes back on its own.',
      params: { retries: 0, retryBudget: null },
      script: SPIKE,
      expect: [{ at: 45, health: ['healthy'] }],
    },
    {
      id: 'one-retry',
      label: 'ONE RETRY',
      description: 'A single retry looks harmless, but it doubles the load whenever requests time out.',
      params: { retries: 1, retryBudget: null },
      script: SPIKE,
      expect: [{ at: 60, health: ['metastable'] }],
    },
    {
      id: 'budget',
      label: '10% RETRY BUDGET',
      description: 'Three retries allowed, but at most one per ten requests overall. Slower to recover, but it does.',
      params: { retries: 3, retryBudget: 0.1 },
      script: SPIKE,
      expect: [{ at: 60, health: ['healthy'] }],
    },
  ],
  readouts: ['health', 'goodput', 'retries', 'wasted', 'clientP99', 'queueDepth'],
  charts: ['throughput', 'latency', 'depth'],
  held: ['utilisation', 'workers', 'queue', 'timeout', 'backoff'],
  takeaways: [
    {
      title: 'The trigger leaves; the failure stays',
      body: 'Once the queue is full of requests whose clients have given up, every completion is wasted and every timeout sends more load. The spike can end and the service still serves nothing: a metastable failure.',
    },
    {
      title: 'Retries multiply load exactly when there is none to spare',
      body: 'At 80% busy, one retry per timed-out request takes the offered load to 160%. Backoff and jitter spread retries out in time, but here they do not reduce how many there are, so the loop holds.',
    },
    {
      title: 'Budget retries across the client, not per request',
      body: 'A retry budget caps retries as a share of all traffic, so retries help with scattered failures but cannot double the load in an outage. Server-side defences break the same loop from the other end.',
    },
  ],
}
