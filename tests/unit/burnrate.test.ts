// Headless checks on the SLO burn-rate demo's model, and on every incident's verdicts at the default settings.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCENARIOS } from '../../src/demos/burnrate/demo.ts'
import {
  BASELINE,
  burnRate,
  DAY,
  DEFAULT_SETTINGS,
  fill,
  flatCurve,
  noise,
  REQUESTS_PER_MINUTE,
  RULE_IDS,
  simulate,
  summarise,
} from '../../src/demos/burnrate/model.ts'
import { DEMO_SEED } from '../../src/demos/definition.ts'

const z = noise(DEMO_SEED)
const day = (curve = flatCurve(), settings = DEFAULT_SETTINGS) => simulate(curve, settings, z)
const scenario = (id: string) => {
  const s = SCENARIOS.find((candidate) => candidate.id === id)
  assert.ok(s, id)
  return day(s.curve())
}

describe('burn-rate model', () => {
  it('is deterministic for a seed', () => {
    const a = simulate(flatCurve(0.01), DEFAULT_SETTINGS, noise(3))
    const b = simulate(flatCurve(0.01), DEFAULT_SETTINGS, noise(3))
    const c = simulate(flatCurve(0.01), DEFAULT_SETTINGS, noise(4))
    assert.deepEqual(a.errors, b.errors)
    assert.notDeepEqual(a.errors, c.errors)
  })

  it('measures the drawn rate, give or take the noise', () => {
    const d = day(flatCurve(0.01))
    const errors = d.prefix[d.prefix.length - 1] - d.prefix[d.prefix.length - 1 - DAY]
    const measured = errors / (DAY * REQUESTS_PER_MINUTE)
    assert.ok(Math.abs(measured - 0.01) / 0.01 < 0.02, `measured ${measured}`)
  })

  it('a burn rate of 1 spends the budget in exactly the SLO window', () => {
    const slo = DEFAULT_SETTINGS.slo
    const d = day(flatCurve(1 - slo))
    const burn = burnRate(d, DAY - 1, 360)
    assert.ok(Math.abs(burn - 1) < 0.1, `6 h burn rate ${burn}`)
    // A day at burn rate 1 spends a thirtieth of the month.
    assert.ok(Math.abs(d.spent[DAY - 1] * 30 - 1) < 0.05, `spent ${d.spent[DAY - 1]}`)
  })

  it('a healthy day pages nobody', () => {
    const d = day()
    assert.equal(d.incident, null)
    for (const rule of RULE_IDS) assert.equal(summarise(d, rule).verdict, 'quiet', rule)
  })

  it('redrawing one stretch changes nothing before it', () => {
    const before = day()
    const after = day(fill(flatCurve(), 600, 620, 0.5))
    assert.deepEqual(before.errors.slice(0, 360 + 600), after.errors.slice(0, 360 + 600))
    assert.ok(after.spent[DAY - 1] > before.spent[DAY - 1])
  })
})

describe('incidents tell their story', () => {
  for (const s of SCENARIOS) {
    if (!s.expect) continue
    it(s.id, () => {
      const d = day(s.curve())
      for (const rule of RULE_IDS) assert.equal(summarise(d, rule).verdict, s.expect?.[rule], rule)
    })
  }

  it('outage: the single window keeps paging most of an hour after the fix; multi-window clears sooner', () => {
    const d = scenario('outage')
    const single = summarise(d, 'single')
    const multi = summarise(d, 'multi')
    const threshold = summarise(d, 'threshold')
    assert.ok(single.clearsAfter !== null && single.clearsAfter >= 45, `single clears after ${single.clearsAfter}`)
    assert.ok(multi.clearsAfter !== null && multi.clearsAfter <= 30, `multi clears after ${multi.clearsAfter}`)
    assert.ok(threshold.clearsAfter !== null && threshold.clearsAfter <= 5)
    // The fast tier on its own clears with its five-minute window.
    let fastLast = -1
    for (let m = 0; m < DAY; m++) if (d.tiers.fast[m]) fastLast = m
    assert.ok(fastLast + 1 - (d.incident?.end ?? 0) <= 5, `fast tier last fired at ${fastLast}`)
  })

  it('on and off: one page from multi-window against one per pulse from the threshold', () => {
    const d = scenario('flapping')
    assert.equal(summarise(d, 'multi').pages, 1)
    assert.equal(summarise(d, 'threshold').pages, 24)
  })

  it('slow leak: only the slow tier fires, hours in', () => {
    const d = scenario('leak')
    assert.ok(d.tiers.fast.every((f) => f === 0))
    const first = summarise(d, 'multi').first
    assert.ok(first !== null && first - 8 * 60 > 4 * 60, `first page at minute ${first}`)
  })

  it('the leak stops mattering under a looser SLO, and the threshold catches it only when set low', () => {
    const leak = SCENARIOS.find((s) => s.id === 'leak')
    assert.ok(leak)
    const loose = day(leak.curve(), { ...DEFAULT_SETTINGS, slo: 0.99 })
    assert.equal(summarise(loose, 'multi').verdict, 'quiet')
    const low = day(leak.curve(), { ...DEFAULT_SETTINGS, threshold: 0.001 })
    assert.equal(summarise(low, 'threshold').verdict, 'caught')
    const blips = SCENARIOS.find((s) => s.id === 'blips')
    assert.ok(blips)
    assert.equal(summarise(day(blips.curve(), { ...DEFAULT_SETTINGS, threshold: 0.001 }), 'threshold').verdict, 'noise')
  })

  it('draw-your-own starts healthy', () => {
    const d = scenario('draw')
    assert.ok(d.curve.every((rate) => rate === BASELINE))
  })
})
