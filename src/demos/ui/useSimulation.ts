import { useCallback, useEffect, useRef, useState } from 'react'
import { DEMO_SEED, type DemoDefinition, type Preset } from '../definition.ts'
import type { Params } from '../engine/params.ts'
import { type Disturbance, SAMPLE_SECONDS, Simulation } from '../engine/simulation.ts'
import { CHARTS, drawChart, drawPipeline, type Palette, type Particle, readPalette } from './canvas.ts'

/** Most particles in flight; past this the pipeline is busy enough to read without them. */
const MAX_PARTICLES = 260
/** React re-renders the readouts this often (real time), whatever the simulation speed. */
const READOUT_MS = 250

export type Speed = 1 | 3 | 10

function build(def: DemoDefinition, preset: Preset | null, params?: Params): Simulation {
  const sim = params
    ? new Simulation(params, DEMO_SEED)
    : new Simulation({ ...def.base, ...preset?.params }, DEMO_SEED, preset?.script ?? [])
  // Run to the first sample, so the readouts have something to show on the first frame.
  sim.advance(SAMPLE_SECONDS)
  return sim
}

/**
 * Owns one demo's simulation: presets, control changes, the animation loop, and the canvases. The loop runs only
 * while the demo is on screen and the tab is visible, so a page of demos runs one at a time.
 */
export function useSimulation(def: DemoDefinition) {
  const [presetId, setPresetId] = useState<string | null>(def.presets[0]?.id ?? null)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState<Speed>(1)
  const [, setTick] = useState(0)
  const simRef = useRef<Simulation>(null as unknown as Simulation)
  if (!simRef.current) simRef.current = build(def, def.presets[0] ?? null)
  const rootRef = useRef<HTMLElement | null>(null)
  const pipelineRef = useRef<HTMLCanvasElement | null>(null)
  const chartRefs = useRef(new Map<string, HTMLCanvasElement>())
  const particles = useRef<Particle[]>([])
  const visible = useRef(true)

  const attach = useCallback((sim: Simulation) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sim.onFlow = (kind, worker) => {
      if (reduced || particles.current.length > MAX_PARTICLES) return
      particles.current.push({ kind, worker, born: performance.now(), jit: Math.random() })
    }
    simRef.current = sim
    particles.current.length = 0
    setTick((n) => n + 1)
  }, [])

  useEffect(() => attach(simRef.current), [attach])

  const loadPreset = useCallback(
    (preset: Preset) => {
      attach(build(def, preset))
      setPresetId(preset.id)
      setRunning(true)
    },
    [def, attach],
  )

  /** Restart: the current preset from the top, or the current settings with no script once they have been changed. */
  const reset = useCallback(() => {
    const preset = def.presets.find((p) => p.id === presetId) ?? null
    attach(preset ? build(def, preset) : build(def, null, { ...simRef.current.params }))
    setRunning(true)
  }, [def, presetId, attach])

  const change = useCallback((patch: Partial<Params>) => {
    simRef.current.set(patch)
    setPresetId(null)
    setTick((n) => n + 1)
  }, [])

  const disturb = useCallback((action: Disturbance) => {
    simRef.current.disturb(action)
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let palette: Palette = readPalette(root)
    let frame = 0
    let last = performance.now()
    let lastReadout = 0
    let raf = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // Capped, so a stalled frame (or a return from another tab) cannot jump the run forward.
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      if (!visible.current || document.hidden) return
      const sim = simRef.current
      if (running && !sim.oom) sim.advance(sim.t + dt * speed)
      if (frame++ % 60 === 0) palette = readPalette(root)
      if (pipelineRef.current) drawPipeline(pipelineRef.current, sim, palette, particles.current, now)
      for (const [id, cv] of chartRefs.current) drawChart(cv, sim, CHARTS[id as keyof typeof CHARTS], palette)
      if (now - lastReadout > READOUT_MS) {
        lastReadout = now
        setTick((n) => n + 1)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, speed])

  const chartRef = useCallback(
    (id: string) => (el: HTMLCanvasElement | null) => {
      if (el) chartRefs.current.set(id, el)
      else chartRefs.current.delete(id)
    },
    [],
  )

  return {
    sim: simRef.current,
    presetId,
    loadPreset,
    reset,
    change,
    disturb,
    running,
    setRunning,
    speed,
    setSpeed,
    rootRef,
    pipelineRef,
    chartRef,
  }
}
