// Headless checks on the demo engine and on every preset's story. Run with `npm run test:unit` (Node's own runner,
// no browser): the engine has no DOM, and seeded runs make each outcome a fixed fact.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONCEPTS } from '../../src/demos/concepts/index.ts'
import { DEMO_SEED } from '../../src/demos/definition.ts'
import { health, Simulation } from '../../src/demos/engine/simulation.ts'
import { theoreticalWait } from '../../src/demos/engine/theory.ts'

const SPIKE = [{ at: 6, action: 'spike' }] as const

describe('engine', () => {
  it('is deterministic for a seed, and the seed matters', () => {
    const run = (seed: number) => {
      const sim = new Simulation({ lambda: 64, retries: 3, timeoutMs: 600 }, seed, SPIKE)
      sim.advance(20)
      return sim.samples.map((s) => [s.offered, s.good, s.depth])
    }
    assert.deepEqual(run(7), run(7))
    assert.notDeepEqual(run(7), run(8))
  })

  it('gives the same run however finely time is advanced', () => {
    const coarse = new Simulation({ lambda: 64 }, 3, SPIKE)
    coarse.advance(15)
    const fine = new Simulation({ lambda: 64 }, 3, SPIKE)
    for (let t = 0; t <= 15; t += 1 / 60) fine.advance(t)
    fine.advance(15)
    assert.deepEqual(
      fine.samples.map((s) => s.good),
      coarse.samples.map((s) => s.good),
    )
  })

  for (const rho of [0.7, 0.95]) {
    it(`converges to M/M/c queue wait at ρ ${rho}`, () => {
      const params = { lambda: rho * 80, retries: 0, timeoutMs: 1e9 }
      const sim = new Simulation(params, 11)
      sim.advance(50)
      sim.set({}) // start the measuring epoch after warm-up
      sim.advance(3000)
      const theory = theoreticalWait({ ...sim.params })
      assert.ok(Math.abs(sim.epochWait - theory) / theory < 0.1, `measured ${sim.epochWait}, theory ${theory}`)
    })
  }

  it("satisfies Little's law in steady state", () => {
    const sim = new Simulation({ lambda: 56, retries: 0, timeoutMs: 1e9 }, 5)
    sim.advance(120)
    const m = sim.latest
    assert.ok(m)
    assert.ok(Math.abs(m.L - m.lamOut * m.W) / m.L < 0.15, `L ${m.L} vs λW ${m.lamOut * m.W}`)
  })

  it('stops at the memory limit instead of growing without end', () => {
    const sim = new Simulation({ lambda: 400, retries: 0, timeoutMs: 1e9 }, 1)
    sim.advance(400)
    assert.equal(sim.oom, true)
    assert.ok(sim.t < 400)
  })

  it('a retry budget refuses retries once spent', () => {
    const sim = new Simulation({ lambda: 64, retries: 3, timeoutMs: 600, retryBudget: 0.1 }, 1, SPIKE)
    sim.advance(20)
    assert.ok(sim.samples.some((s) => s.denied > 0))
  })
})

describe('presets tell their story', () => {
  for (const demo of CONCEPTS) {
    for (const preset of demo.presets) {
      if (!preset.expect?.length) continue
      it(`${demo.slug} / ${preset.id}`, () => {
        const sim = new Simulation({ ...demo.base, ...preset.params }, DEMO_SEED, preset.script)
        for (const expectation of preset.expect ?? []) {
          sim.advance(expectation.at)
          assert.ok(sim.latest)
          const state = health(sim, sim.latest).id
          assert.ok(
            expectation.health.includes(state),
            `at ${expectation.at} s: ${state}, expected ${expectation.health}`,
          )
        }
      })
    }
  }

  it('queueing-knee: each preset waits longer than the last, and a heavy tail at 80% beats tight work at 95%', () => {
    const demo = CONCEPTS.find((d) => d.slug === 'queueing-knee')
    assert.ok(demo)
    const theory = (lambda: number, variability: 'low' | 'exp' | 'heavy') =>
      theoreticalWait({ lambda, workers: 8, svcMs: 100, variability })
    assert.ok(theory(68, 'exp') / theory(56, 'exp') > 3.5)
    assert.ok(theory(76, 'exp') / theory(68, 'exp') > 3.5)
    assert.ok(theory(64, 'heavy') > theory(76, 'low'))
  })
})
