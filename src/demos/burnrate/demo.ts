// The SLO burn-rate demo's words and scenarios. Pure data, read by the catalogue (and so scripts/pages.ts) and by the
// page; tests/unit checks each scenario's verdicts at the default settings.
import type { CatalogueEntry } from '../catalogue.ts'
import { BASELINE, type Curve, fill, flatCurve, type RuleId, type Verdict } from './model.ts'

export interface Scenario {
  id: string
  label: string
  /** One sentence: what to watch for. */
  description: string
  curve: () => Curve
  /** Each rule's verdict at the default settings, checked by tests/unit. */
  expect?: Record<RuleId, Verdict>
}

const at = (hours: number, minutes = 0) => hours * 60 + minutes

/** Pulses of `minutes` at `rate`, every `every` minutes, from `from` until `to`. */
function pulses(curve: Curve, from: number, to: number, every: number, minutes: number, rate: number): Curve {
  for (let m = from; m < to; m += every) fill(curve, m, m + minutes, rate)
  return curve
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'blips',
    label: 'TWO BLIPS',
    description:
      'A one-minute spike to 50% errors, and later three minutes at 10%. Loud on the chart, cheap in budget: watch which rules page anyway.',
    curve: () => fill(fill(flatCurve(), at(9), at(9, 1), 0.5), at(15), at(15, 3), 0.1),
    expect: { threshold: 'noise', single: 'quiet', multi: 'quiet' },
  },
  {
    id: 'outage',
    label: 'PARTIAL OUTAGE',
    description:
      'Thirty percent of requests fail for twenty minutes, then it is fixed. Everything pages; watch how long each rule keeps paging after the fix.',
    curve: () => fill(flatCurve(), at(10), at(10, 20), 0.3),
    expect: { threshold: 'caught', single: 'caught', multi: 'caught' },
  },
  {
    id: 'leak',
    label: 'SLOW LEAK',
    description:
      "A bad deploy at 08:00 fails 0.7% of requests for the rest of the day. Under the threshold, and under the hourly burn rate, but it spends 15% of the month's budget.",
    curve: () => fill(flatCurve(), at(8), at(24), 0.007),
    expect: { threshold: 'missed', single: 'missed', multi: 'caught' },
  },
  {
    id: 'flapping',
    label: 'ON AND OFF',
    description:
      'Three minutes at 5% errors every quarter of an hour, for six hours. Count the pages: one rule fires on every pulse, one never fires, one fires once.',
    curve: () => pulses(flatCurve(), at(8), at(14), 15, 3, 0.05),
    expect: { threshold: 'flapping', single: 'missed', multi: 'caught' },
  },
  {
    id: 'draw',
    label: 'DRAW YOUR OWN',
    description: 'A healthy day. Drag across the chart to draw an incident, and see which rules page for it.',
    curve: () => flatCurve(BASELINE),
  },
]

export const BURN_RATE: CatalogueEntry = {
  slug: 'slo-burn-rate',
  name: 'SLO burn-rate alerting',
  title: 'SLO BURN RATE',
  question: 'Which alerts should page you, and which ones are just noise?',
  summary:
    'Draw an incident across a day of traffic, and watch a fixed threshold, a single burn-rate alert, and multi-window burn-rate alerts decide whether to page.',
  tags: ['SLO', 'ERROR BUDGET', 'BURN RATE', 'ALERTING'],
  kind: 'simulated',
  takeaways: [
    {
      title: 'Alert on the budget, not the error rate',
      body: 'An error rate says how bad this minute is. A burn rate says how fast the month is going: 14.4x for an hour spends 2% of a 30-day budget, 6x for six hours spends 5%. A tall, short spike can matter less than a flat line you would never notice.',
    },
    {
      title: 'The short window clears the alert',
      body: 'An hour-long window keeps paging for most of an hour after the fix, because the bad minutes are still inside it. Requiring a window a twelfth as long to agree as well clears the page once that short window is clean: five minutes for the fast tier, half an hour for the slow one.',
    },
    {
      title: 'Two speeds catch two kinds of trouble',
      body: 'The fast tier catches outages within minutes. The slow tier catches leaks that never look alarming on any one chart. Lowering a fixed threshold far enough to catch the leak would page for every blip.',
    },
  ],
}
