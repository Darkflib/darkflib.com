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

  it('counts server latency from the queue, not from a caller blocked upstream', () => {
    const sim = new Simulation({ lambda: 100, retries: 0, timeoutMs: 2000, policy: 'block', cap: 50 }, 1)
    sim.advance(30)
    const m = sim.latest
    assert.ok(m)
    assert.ok(m.held > 200, `held ${m.held}`)
    assert.ok(m.p99 < 1.5, `server p99 ${m.p99}`)
  })

  it('leaving block mode admits held callers only up to the new limit, and rejects the rest', () => {
    const sim = new Simulation({ lambda: 100, retries: 0, timeoutMs: 2000, policy: 'block', cap: 50 }, 1)
    sim.advance(10)
    assert.ok(sim.held.length > 100, `held ${sim.held.length}`)
    sim.set({ policy: 'drop' })
    assert.equal(sim.held.length, 0)
    assert.ok(sim.queue.length <= 50, `queue ${sim.queue.length}`)
    sim.advance(12)
    assert.ok(sim.samples.some((s) => s.drops > 0))
  })

  it('runs with the autoscaler off exactly as it did before there was one', () => {
    const run = (params: object) => {
      const sim = new Simulation({ lambda: 64, retries: 3, timeoutMs: 600, ...params }, 4, SPIKE)
      sim.advance(30)
      return sim.samples.map((s) => [s.good, s.depth])
    }
    // Autoscaler settings are inert while it is off: no scale events join the queue.
    assert.deepEqual(run({}), run({ metricLagS: 9, bootS: 9, cooldownS: 9 }))
  })

  it('an autoscaler starts workers after the start-up time, and cancels those still starting first', () => {
    const sim = new Simulation({ lambda: 60, workers: 4, autoscale: true, bootS: 5, retries: 0 }, 1)
    sim.advance(2.5)
    assert.equal(sim.params.workers, 4)
    assert.ok(sim.booting > 0, `booting ${sim.booting}`)
    const first = sim.scaleLog[0]
    sim.advance(first.t + 5.01)
    assert.ok(sim.params.workers > 4, `workers ${sim.params.workers}`)
    sim.set({ lambda: 1 })
    sim.advance(40)
    assert.equal(sim.booting, 0)
    assert.equal(sim.params.workers, 2)
  })

  it('switching the autoscaler off stops it at once, even with a decision already queued', () => {
    const sim = new Simulation({ lambda: 60, workers: 2, autoscale: true, retries: 0 }, 1)
    sim.advance(1)
    sim.set({ autoscale: false })
    sim.advance(10)
    assert.equal(sim.scaleLog.length, 0)
    assert.equal(sim.params.workers, 2)
  })

  it('utilisation counts only the pool, not workers finishing up after a scale-down', () => {
    // Eight long, widely varying requests and nothing queued behind them, then the pool is cut to two.
    const sim = new Simulation(
      { lambda: 1000, workers: 8, svcMs: 4000, variability: 'heavy', policy: 'drop', cap: 0, retries: 0 },
      1,
    )
    sim.advance(0.1)
    sim.set({ lambda: 0.001, workers: 2 })
    // Find a window in which the pool sat idle while stopped workers were still busy: utilisation must read 0.
    let idleFor = 0
    let checked = false
    for (let t = 0.25; t < 120 && !checked; t += 0.25) {
      sim.advance(t)
      const poolIdle = !sim.workers[0].req && !sim.workers[1].req
      idleFor = poolIdle ? idleFor + 1 : 0
      if (idleFor > 8 && sim.workers.slice(2, 8).some((w) => w.req)) {
        assert.equal(sim.latest?.util, 0)
        checked = true
      }
    }
    assert.ok(checked, 'no window with an idle pool and busy stopped workers')
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

  const run = (slug: string, presetId: string) => {
    const demo = CONCEPTS.find((d) => d.slug === slug)
    const preset = demo?.presets.find((p) => p.id === presetId)
    assert.ok(demo && preset, `${slug} / ${presetId}`)
    return new Simulation({ ...demo.base, ...preset.params }, DEMO_SEED, preset.script)
  }
  const at = (sim: Simulation, t: number) => {
    sim.advance(t)
    assert.ok(sim.latest)
    return sim.latest
  }

  it('overload: blocking holds the server queue at its limit while the backlog builds upstream', () => {
    const block = run('overload', 'block')
    const early = at(block, 20)
    const late = at(block, 40)
    assert.equal(late.depth, 50)
    assert.ok(late.held > early.held + 200, `held ${early.held} then ${late.held}`)
    assert.ok(late.good < 1, `goodput ${late.good}`)
    const reject = at(run('overload', 'reject'), 40)
    assert.ok(reject.good > 0.6 * reject.fresh, `goodput ${reject.good} of ${reject.fresh}`)
  })

  it('breaking-the-loop: skip-expired alone never drains; newest-first strands dead work until skip clears it', () => {
    const skip = run('breaking-the-loop', 'skip-expired')
    for (const t of [60, 90, 120]) {
      const m = at(skip, t)
      assert.ok(m.good < 0.2 * m.fresh, `at ${t} s: goodput ${m.good} of ${m.fresh}`)
    }
    const lifo = at(run('breaking-the-loop', 'lifo'), 30)
    assert.ok(lifo.good > 0.6 * lifo.fresh, `goodput ${lifo.good} of ${lifo.fresh}`)
    assert.ok(lifo.depth > 500, `queue ${lifo.depth}`)
    const both = at(run('breaking-the-loop', 'lifo-skip'), 25)
    assert.ok(both.depth < 50, `queue ${both.depth}`)
  })

  it('autoscaler: delays make it swing end to end on a steady load; none, or a cooldown, keep it near the need', () => {
    // From 50 s the load is steady at 30/s, which needs 5 workers at 60%.
    const range = (presetId: string, from: number, to: number) => {
      const sim = run('autoscaler', presetId)
      let lo = Number.POSITIVE_INFINITY
      let hi = 0
      for (let t = from; t <= to; t += 0.25) {
        const m = at(sim, t)
        lo = Math.min(lo, m.pool)
        hi = Math.max(hi, m.pool)
      }
      return { lo, hi, actions: sim.scaleLog.length }
    }
    for (const id of ['oscillate', 'stale']) {
      const r = range(id, 50, 120)
      assert.ok(r.lo <= 3 && r.hi >= 30, `${id}: pool ${r.lo} to ${r.hi}`)
    }
    const instant = range('instant', 50, 120)
    assert.ok(instant.lo >= 2 && instant.hi <= 10, `instant: pool ${instant.lo} to ${instant.hi}`)
    const surge = range('instant', 25, 40)
    assert.ok(surge.lo >= 7 && surge.hi <= 16, `instant in the surge: pool ${surge.lo} to ${surge.hi}`)
    const cooldown = range('cooldown', 10, 120)
    assert.ok(cooldown.hi <= 16, `cooldown: peak ${cooldown.hi}`)
    assert.ok(cooldown.actions <= 12, `cooldown: ${cooldown.actions} actions`)
  })

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
