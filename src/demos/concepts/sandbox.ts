import type { DemoDefinition } from '../definition.ts'
import { DEFAULTS } from '../engine/params.ts'

const SLOW = [{ at: 6, action: 'slow' }] as const

export const sandbox: DemoDefinition = {
  slug: 'sandbox',
  name: 'Full sandbox',
  title: 'FULL SANDBOX',
  question: 'What happens when every knob is yours?',
  summary:
    'Every parameter the engine has, both disturbances, and six scenarios to start from. Build your own outage, then try to get out of it.',
  tags: ['SANDBOX', 'QUEUEING', 'RETRIES', 'LOAD SHEDDING'],
  base: DEFAULTS,
  controls: [
    'load',
    'workers',
    'serviceTime',
    'variability',
    'admission',
    'queueLimit',
    'queueAge',
    'lifo',
    'dropExpired',
    'timeout',
    'retries',
    'backoff',
    'jitter',
    'retryBudget',
  ],
  actions: ['spike', 'slow'],
  presets: [
    {
      id: 'steady',
      label: 'STEADY',
      description:
        'The defaults: 70% busy, a 1 s timeout, two jittered retries, an unbounded queue. Calm until you press a button.',
      params: {},
      expect: [{ at: 30, health: ['healthy'] }],
    },
    {
      id: 'spike',
      label: 'SPIKE',
      description: 'A five-second spike at 6 s. Jittered backoff does not save it: the retries keep the service down.',
      params: {},
      script: [{ at: 6, action: 'spike' }],
      expect: [{ at: 60, health: ['metastable'] }],
    },
    {
      id: 'slow',
      label: 'SLOWDOWN',
      description: 'Service time triples for ten seconds from 6 s. The dependency recovers; the service does not.',
      params: {},
      script: SLOW,
      expect: [{ at: 60, health: ['metastable'] }],
    },
    {
      id: 'bounded',
      label: 'BOUNDED QUEUE',
      description:
        'The same slowdown, with a queue of 40 that rejects the rest. It fails while the dependency is slow and recovers as soon as it is not.',
      params: { policy: 'drop', cap: 40 },
      script: SLOW,
      expect: [{ at: 30, health: ['healthy'] }],
    },
    {
      id: 'budget',
      label: 'RETRY BUDGET',
      description:
        'Retries capped at one per ten requests. The backlog takes about twenty seconds to drain, but it does.',
      params: { retryBudget: 0.1 },
      script: SLOW,
      expect: [
        { at: 25, health: ['recovering'] },
        { at: 60, health: ['healthy'] },
      ],
    },
    {
      id: 'defences',
      label: 'ALL DEFENCES',
      description:
        'Shed by age, newest first, skip expired work. Goodput drops during the slowdown but never to zero, and it is back as soon as the dependency is.',
      params: { policy: 'codel', discipline: 'lifo', dropExpired: true },
      script: SLOW,
      expect: [{ at: 30, health: ['healthy'] }],
    },
  ],
  readouts: [
    'health',
    'utilisation',
    'goodput',
    'retries',
    'shed',
    'wasted',
    'clientP99',
    'serverLatency',
    'queueDepth',
    'blocked',
  ],
  charts: ['throughput', 'backlog', 'latency'],
  held: [],
  takeaways: [
    {
      title: 'Change one thing at a time',
      body: 'The other demos hold most of this still for a reason. Pick a scenario, change one control, and compare it with the scenario as it was.',
    },
    {
      title: 'The state pill is a heuristic',
      body: 'METASTABLE means goodput has collapsed with nothing disturbing the system and the backlog not shrinking. Unusual settings can fool it; the charts are the ground truth.',
    },
    {
      title: 'Seeded, so it repeats',
      body: 'Every run starts from the same seed. A scenario plays out the same way each time, and so does a setup of your own after RESET.',
    },
  ],
}
