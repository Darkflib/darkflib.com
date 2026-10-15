import type { DemoDefinition } from '../definition.ts'

export const overload: DemoDefinition = {
  slug: 'overload',
  name: 'Where does overload go?',
  title: 'WHERE DOES OVERLOAD GO?',
  question: 'When requests arrive faster than they can be served, where does the excess end up?',
  summary:
    'Load at 125% of capacity, with nothing to absorb it. An unbounded queue turns the excess into latency, a bounded one into fast errors, and blocking hides it in the callers.',
  tags: ['OVERLOAD', 'QUEUE LIMITS', 'LOAD SHEDDING', 'BACKPRESSURE'],
  base: {
    lambda: 100,
    workers: 8,
    svcMs: 100,
    variability: 'exp',
    discipline: 'fifo',
    timeoutMs: 2000,
    retries: 0,
    retryBudget: null,
    dropExpired: false,
  },
  controls: ['queuePolicy', 'queueLimit'],
  actions: [],
  presets: [
    {
      id: 'unbounded',
      label: 'UNBOUNDED',
      description:
        'The queue grows by 20 requests a second. Within ten seconds every request waits longer than the 2 s timeout, and the workers serve nothing anyone still wants.',
      params: { policy: 'unbounded', cap: 50 },
      expect: [
        { at: 30, health: ['collapsed'] },
        { at: 60, health: ['collapsed'] },
      ],
    },
    {
      id: 'reject',
      label: 'REJECT AT THE DOOR',
      description:
        'A limit of 50 keeps the wait near 0.6 s. One request in five gets a fast error; the rest are served in time.',
      params: { policy: 'drop', cap: 50 },
      expect: [
        { at: 30, health: ['shedding'] },
        { at: 60, health: ['shedding'] },
      ],
    },
    {
      id: 'block',
      label: 'BLOCK THE CALLER',
      description:
        "The same limit, but callers wait for a slot instead of being refused. The server's queue and latency look fine; the backlog builds upstream, and nothing arrives in time.",
      params: { policy: 'block', cap: 50 },
      expect: [
        { at: 30, health: ['collapsed'] },
        { at: 60, health: ['collapsed'] },
      ],
    },
    {
      id: 'too-long',
      label: 'LIMIT TOO LONG',
      description:
        'Reject when full, with a limit of 400. At 80 a second that is five seconds of waiting, longer than the timeout, so it rejects too late to help.',
      params: { policy: 'drop', cap: 400 },
      expect: [{ at: 60, health: ['collapsed'] }],
    },
  ],
  readouts: ['health', 'goodput', 'shed', 'wasted', 'serverLatency', 'queueDepth', 'blocked'],
  charts: ['throughput', 'backlog', 'latency'],
  held: ['utilisation', 'workers', 'service', 'discipline', 'timeout', 'retries'],
  takeaways: [
    {
      title: 'Overload has to go somewhere',
      body: 'Past 100% busy the excess becomes queue, errors, or blocked callers. A queue policy decides which of those you get, not whether you get one.',
    },
    {
      title: 'Size a queue in seconds, not requests',
      body: 'A queue limit is a wait limit: the limit divided by throughput. Keep it below the client timeout, or the queue fills with work nobody is waiting for and the limit only rejects what is already lost.',
    },
    {
      title: 'Blocking moves the queue; it does not remove it',
      body: "Backpressure helps only if the caller can slow its own source. Here it cannot, so the backlog sits in threads and connections upstream, where the server's dashboards cannot see it.",
    },
  ],
}
