import type { DemoDefinition } from '../definition.ts'

const CAPACITY = 80 // 8 workers at 100 ms

export const queueingKnee: DemoDefinition = {
  slug: 'queueing-knee',
  name: 'The queueing knee',
  title: 'THE QUEUEING KNEE',
  question: 'Why does latency explode when the service is only 85% busy?',
  summary:
    'Push utilisation from 70% to 95% and watch queue wait multiply, then make service times less predictable and watch it happen sooner.',
  tags: ['QUEUEING', 'UTILISATION', 'LATENCY', "LITTLE'S LAW"],
  base: { workers: 8, svcMs: 100, policy: 'unbounded', discipline: 'fifo', retries: 0, timeoutMs: 3_600_000 },
  controls: ['utilisation', 'variability'],
  actions: [],
  presets: [
    {
      id: 'comfortable',
      label: '70% BUSY',
      description: 'Plenty of headroom: requests rarely wait for a worker.',
      params: { lambda: 0.7 * CAPACITY, variability: 'exp' },
      expect: [{ at: 30, health: ['healthy'] }],
    },
    {
      id: 'busy',
      label: '85% BUSY',
      description: '15% more load than the last preset; roughly four times the queue wait.',
      params: { lambda: 0.85 * CAPACITY, variability: 'exp' },
    },
    {
      id: 'knee',
      label: '95% BUSY',
      description: 'Past the knee. The queue wait is now longer than the work itself, and swings wildly.',
      params: { lambda: 0.95 * CAPACITY, variability: 'exp' },
      expect: [{ at: 30, health: ['knee'] }],
    },
    {
      id: 'heavy',
      label: 'HEAVY TAIL AT 80%',
      description: 'Same hardware, same average work, but a few requests take far longer. The tail goes first.',
      params: { lambda: 0.8 * CAPACITY, variability: 'heavy' },
    },
  ],
  readouts: ['utilisation', 'queueWait', 'serverLatency', 'littles'],
  charts: ['latency', 'depth'],
  held: ['workers', 'service', 'queue', 'timeout'],
  visual: 'knee-curve',
  takeaways: [
    {
      title: 'Wait grows with ρ/(1−ρ)',
      body: 'Going from 70% to 85% busy halves the headroom and roughly quadruples the wait. From 85% to 95% it does it again. "We are only at 85% CPU" is already a statement about latency.',
    },
    {
      title: 'Variability costs as much as load',
      body: "Kingman's formula multiplies the wait by the variability of service times. A heavy tail at 80% can queue worse than predictable work at 95%: fix the slow requests before buying servers.",
    },
    {
      title: "Little's law checks the model",
      body: 'L = λW holds for any stable queue. When the number in the system and arrival rate × time in system disagree, the queue is not in steady state, usually because it is still growing.',
    },
  ],
}
