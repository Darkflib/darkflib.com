import type { DemoDefinition } from '../definition.ts'

const SPIKE = [{ at: 6, action: 'spike' }] as const
const OFF = { dropExpired: false, policy: 'unbounded', discipline: 'fifo' } as const

export const breakingTheLoop: DemoDefinition = {
  slug: 'breaking-the-loop',
  name: 'Breaking the loop',
  title: 'BREAKING THE LOOP',
  question: 'Which server-side defence gets a service out of a retry storm?',
  summary:
    'The retry storm again: three lockstep retries and a five-second spike. Switch on skipping expired work, shedding by queue age, or newest-first serving, and see which ones break the loop.',
  tags: ['RETRIES', 'METASTABILITY', 'LOAD SHEDDING', 'LIFO'],
  base: {
    lambda: 64,
    workers: 8,
    svcMs: 100,
    variability: 'exp',
    cap: 500,
    ageMs: 100,
    timeoutMs: 600,
    retries: 3,
    backoffMs: 50,
    jitter: false,
    retryBudget: null,
    ...OFF,
  },
  controls: ['dropExpired', 'shedByAge', 'lifo'],
  actions: ['spike'],
  presets: [
    {
      id: 'none',
      label: 'NO DEFENCES',
      description: 'The storm as it was: the spike ends at 11 s, and the service stays down.',
      params: OFF,
      script: SPIKE,
      expect: [
        { at: 4, health: ['healthy'] },
        { at: 60, health: ['metastable'] },
      ],
    },
    {
      id: 'skip-expired',
      label: 'SKIP EXPIRED',
      description:
        'The workers stop serving dead requests, but every one of them has already been retried, and what survives the skip has nearly timed out. Goodput stays near zero.',
      params: { ...OFF, dropExpired: true },
      script: SPIKE,
      // The backlog wobbles around 150, so the pill flickers to RECOVERING; it never drains (see engine.test.ts).
      expect: [
        { at: 60, health: ['metastable', 'recovering'] },
        { at: 90, health: ['metastable', 'recovering'] },
      ],
    },
    {
      id: 'shed-by-age',
      label: 'SHED BY AGE',
      description:
        'Anything queued over 100 ms is turned away when it reaches the front. The fast errors still cause retries, but the queue cannot fill, so the service is back within seconds of the spike ending.',
      params: { ...OFF, policy: 'codel' },
      script: SPIKE,
      expect: [
        { at: 30, health: ['healthy'] },
        { at: 60, health: ['healthy'] },
      ],
    },
    {
      id: 'lifo',
      label: 'NEWEST FIRST',
      description:
        'Fresh requests are served while their clients are still waiting, so goodput barely dips. The dead ones stay at the bottom of the stack: over a thousand at 20 s, not cleared for well over a minute.',
      params: { ...OFF, discipline: 'lifo' },
      script: SPIKE,
      expect: [
        { at: 30, health: ['healthy'] },
        { at: 60, health: ['healthy'] },
      ],
    },
    {
      id: 'lifo-skip',
      label: 'NEWEST FIRST + SKIP',
      description:
        'Newest first, and skip anything already timed out. The stranded pile is thrown away, and the queue is empty by 20 s.',
      params: { ...OFF, discipline: 'lifo', dropExpired: true },
      script: SPIKE,
      expect: [
        { at: 25, health: ['healthy'] },
        { at: 60, health: ['healthy'] },
      ],
    },
  ],
  readouts: ['health', 'goodput', 'retries', 'shed', 'wasted', 'queueDepth'],
  charts: ['throughput', 'depth', 'latency'],
  held: ['utilisation', 'workers', 'timeout', 'retries', 'backoff', 'shedding'],
  takeaways: [
    {
      title: 'Break any link and the loop stops',
      body: 'The storm is a loop: a long queue makes requests time out, timeouts make retries, and retries make the queue longer. Shedding by age caps the queue; newest-first stops fresh work timing out. Either is enough here.',
    },
    {
      title: 'Skipping dead work is not enough on its own',
      body: 'It saves the workers, but the client has already retried, and in a FIFO queue whatever survives has waited almost as long as the timeout. Paired with newest-first, it clears the pile that newest-first leaves behind.',
    },
    {
      title: 'A fast error beats a slow success',
      body: 'A request turned away in a millisecond costs the client one retry. A request served after its timeout costs a worker the full service time, and the client retries anyway.',
    },
  ],
}
