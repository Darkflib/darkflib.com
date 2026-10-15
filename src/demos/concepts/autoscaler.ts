import type { DemoDefinition } from '../definition.ts'

const SURGE = [{ at: 10, action: 'surge' }] as const

export const autoscaler: DemoDefinition = {
  slug: 'autoscaler',
  name: 'Autoscaler oscillation',
  title: 'AUTOSCALER OSCILLATION',
  question: 'Why does the autoscaler keep swinging between too many workers and too few?',
  summary:
    'Load doubles for thirty seconds, and an autoscaler sizes the pool to keep it 60% busy. With a stale metric and slow start-up it overshoots, then swings from 2 workers to 32 and back long after the load has settled.',
  tags: ['AUTOSCALING', 'FEEDBACK LOOPS', 'CONTROL LAG', 'CAPACITY'],
  base: {
    lambda: 30,
    workers: 5,
    svcMs: 100,
    variability: 'exp',
    policy: 'unbounded',
    discipline: 'fifo',
    timeoutMs: 1000,
    retries: 0,
    dropExpired: false,
    autoscale: true,
    scaleTarget: 0.6,
    minWorkers: 2,
    maxWorkers: 32,
  },
  controls: ['metricLag', 'bootTime', 'cooldown', 'scaleTarget'],
  actions: ['surge'],
  presets: [
    {
      id: 'oscillate',
      label: 'STALE AND SLOW',
      description:
        'A 4 s old metric and 6 s to start a worker. The surge ends at 40 s; the swings from 2 workers to 32 never do.',
      params: { metricLagS: 4, bootS: 6, cooldownS: 0 },
      script: SURGE,
    },
    {
      id: 'instant',
      label: 'NO DELAYS',
      description:
        'A fresh metric and workers that start at once. The pool follows the load up to about 10 and back down to 5.',
      params: { metricLagS: 0, bootS: 0, cooldownS: 0 },
      script: SURGE,
    },
    {
      id: 'stale',
      label: 'STALE METRIC ONLY',
      description: 'Workers start at once, but the metric is 5 s old. That alone is enough to keep it swinging.',
      params: { metricLagS: 5, bootS: 0, cooldownS: 0 },
      script: SURGE,
    },
    {
      id: 'cooldown',
      label: '12 S COOLDOWN',
      description:
        'The same delays, but no action until the last one has had time to show up in the metric. Slower, and it settles.',
      params: { metricLagS: 4, bootS: 6, cooldownS: 12 },
      script: SURGE,
    },
  ],
  readouts: ['pool', 'seenUtil', 'scaling', 'clientP99', 'health', 'queueDepth'],
  charts: ['workers', 'throughput', 'latency'],
  held: ['arrivals', 'service', 'autoscaler', 'timeout', 'retries'],
  takeaways: [
    {
      title: 'The controller acts on a pool that no longer exists',
      body: 'It multiplies the workers it has now by a utilisation measured before its last change landed. While new workers are still starting, the old metric says "still overloaded", so it asks again, and again. Then the fresh metric shows a pool far too big, and it cuts just as hard.',
    },
    {
      title: 'Delay, not load, causes the swing',
      body: 'The load is steady from 40 s, and the stale run swings anyway. A full correction every interval is only stable if the controller sees the result of its last action before it makes the next one. Metric lag, scrape intervals, averaging windows and start-up time all add to that delay.',
    },
    {
      title: 'Wait out the loop, and scale down slowly',
      body: 'A cooldown longer than metric lag plus start-up time lets each action show up before the next. Real autoscalers go further: Kubernetes scales down on the highest recommendation of the last five minutes, so a brief lull cannot strip the pool. The cost is a slower response, so keep headroom for the ramp.',
    },
  ],
}
