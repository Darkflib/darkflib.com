// Canvas drawing for the simulated demos: the live pipeline and the strip charts. Colours come from the --sim-*
// custom properties on the demo element, so the palette lives in CSS with the rest of the site's.
import type { ChartId } from '../definition.ts'
import { SAMPLE_SECONDS, type Sample, type Simulation } from '../engine/simulation.ts'
import { fmtCount, fmtRate, fmtSeconds } from '../registry.ts'

export interface Palette {
  ink: string
  muted: string
  rule: string
  accent: string
  ok: string
  warn: string
  crit: string
  zombie: string
  font: string
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el)
  const v = (name: string) => cs.getPropertyValue(`--sim-${name}`).trim()
  return {
    ink: v('ink'),
    muted: v('muted'),
    rule: v('rule'),
    accent: v('accent'),
    ok: v('ok'),
    warn: v('warn'),
    crit: v('crit'),
    zombie: v('zombie'),
    font: cs.getPropertyValue('--font-mono').trim(),
  }
}

/** Size the backing store to the element, at up to 2x for sharp lines, and return a context in CSS pixels. */
export function fit(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const r = cv.getBoundingClientRect()
  const w = Math.max(1, r.width)
  const h = Math.max(1, r.height)
  const W = Math.round(w * dpr)
  const H = Math.round(h * dpr)
  if (cv.width !== W || cv.height !== H) {
    cv.width = W
    cv.height = H
  }
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

// ---------- Pipeline ----------

export interface Particle {
  kind: 'arrive' | 'drop' | 'skip' | 'ok' | 'waste'
  worker?: number
  born: number
  jit: number
}

export function drawPipeline(cv: HTMLCanvasElement, sim: Simulation, c: Palette, particles: Particle[], now: number) {
  const { ctx, w, h } = fit(cv)
  const p = sim.params
  ctx.clearRect(0, 0, w, h)
  const narrow = w < 560
  const cy = h / 2
  const sx = 30
  const qx0 = narrow ? 92 : Math.max(130, w * 0.19)
  const qx1 = narrow ? w * 0.56 : w * 0.58
  const wx0 = qx1 + (narrow ? 14 : 28)
  // Room on the right for the outcome labels, which sit beside their dots.
  const wx1 = w - (narrow ? 58 : 140)
  const kx = w - (narrow ? 26 : 84)
  const tubeH = 84
  const qTop = cy - tubeH / 2
  const font = (size: number, weight = 400) => `${weight} ${size}px ${c.font}`
  ctx.textBaseline = 'middle'

  // Clients
  const blocked = sim.held.length > 0
  ctx.beginPath()
  ctx.arc(sx, cy, 14, 0, Math.PI * 2)
  ctx.fillStyle = blocked ? c.warn : c.accent
  ctx.shadowColor = ctx.fillStyle
  ctx.shadowBlur = 10
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = c.muted
  ctx.font = font(10, 500)
  ctx.textAlign = 'center'
  ctx.fillText('CLIENTS', sx + 4, cy - 30)
  ctx.fillStyle = c.ink
  ctx.font = font(11)
  ctx.fillText(`${fmtRate(p.lambda * (sim.spiking ? 2 : 1))}/S`, sx + 4, cy + 30)

  // Queue
  ctx.strokeStyle = c.rule
  ctx.lineWidth = 1
  ctx.strokeRect(qx0 + 0.5, qTop + 0.5, qx1 - qx0, tubeH)
  const cell = 6
  const step = cell + 2
  const rows = Math.floor((tubeH - 8) / step)
  const cols = Math.max(1, Math.floor((qx1 - qx0 - 8) / step))
  const maxVis = rows * cols
  const q = sim.queue
  const qlen = q.length
  const shown = Math.min(qlen, maxVis)
  for (let k = 0; k < shown; k++) {
    const r = p.discipline === 'lifo' ? q.get(qlen - 1 - k) : q.get(k)
    const col = Math.floor(k / rows)
    const row = k % rows
    const x = qx1 - 4 - cell - col * step
    const y = qTop + 4 + row * step
    if (r.abandoned) {
      ctx.strokeStyle = c.zombie
      ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
    } else {
      ctx.fillStyle = c.accent
      ctx.fillRect(x, y, cell, cell)
    }
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = c.muted
  ctx.font = font(10, 500)
  ctx.fillText(`QUEUE ${qlen.toLocaleString('en-GB')}`, qx0, qTop - 12)
  ctx.textAlign = 'right'
  ctx.fillText(p.policy === 'unbounded' ? 'NO LIMIT' : `LIMIT ${p.cap.toLocaleString('en-GB')}`, qx1, qTop - 12)
  if (qlen > maxVis) {
    ctx.textAlign = 'left'
    ctx.fillStyle = c.ink
    ctx.font = font(11, 500)
    ctx.fillText(`+${(qlen - maxVis).toLocaleString('en-GB')} MORE`, qx0, qTop + tubeH + 14)
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = c.muted
  ctx.font = font(10)
  ctx.fillText(p.discipline.toUpperCase(), qx1, qTop + tubeH + 14)

  // Workers
  const count = p.workers
  const ww = Math.max(20, wx1 - wx0)
  const wh = h - 70
  let best = { s: 0, cols: 1, rows: 1 }
  for (let cc = 1; cc <= count; cc++) {
    const rr = Math.ceil(count / cc)
    const s = Math.min((ww - (cc - 1) * 4) / cc, (wh - (rr - 1) * 4) / rr)
    if (s > best.s) best = { s, cols: cc, rows: rr }
  }
  const bs = Math.min(30, Math.floor(best.s))
  const gw = best.cols * bs + (best.cols - 1) * 4
  const gh = best.rows * bs + (best.rows - 1) * 4
  const gx = wx0 + (ww - gw) / 2
  const gy = cy - gh / 2
  const wpos: { x: number; y: number }[] = []
  let busy = 0
  for (let i = 0; i < count; i++) {
    const col = i % best.cols
    const row = Math.floor(i / best.cols)
    const x = gx + col * (bs + 4)
    const y = gy + row * (bs + 4)
    wpos[i] = { x: x + bs, y: y + bs / 2 }
    const wk = sim.workers[i]
    if (wk.req) {
      busy++
      const progress = Math.max(0, Math.min(1, (sim.t - wk.start) / wk.dur))
      ctx.fillStyle = wk.req.abandoned ? c.zombie : c.accent
      ctx.globalAlpha = 0.22
      ctx.fillRect(x, y, bs, bs)
      ctx.globalAlpha = 1
      const fill = Math.max(2, bs * progress)
      ctx.fillRect(x, y + bs - fill, bs, fill)
    }
    ctx.strokeStyle = c.rule
    ctx.strokeRect(x + 0.5, y + 0.5, bs - 1, bs - 1)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = c.muted
  ctx.font = font(10, 500)
  ctx.fillText(`WORKERS ${busy}/${count}`, wx0 + ww / 2, gy - 14)
  if (sim.slowing) {
    ctx.fillStyle = c.warn
    ctx.fillText('DEPENDENCY SLOW ×3', wx0 + ww / 2, gy + gh + 16)
  }

  // Outcomes
  const okY = cy - 22
  const badY = cy + 22
  ctx.beginPath()
  ctx.arc(kx, okY, 7, 0, Math.PI * 2)
  ctx.fillStyle = c.ok
  ctx.fill()
  ctx.beginPath()
  ctx.arc(kx, badY, 7, 0, Math.PI * 2)
  ctx.fillStyle = c.zombie
  ctx.fill()
  if (!narrow) {
    ctx.textAlign = 'left'
    ctx.font = font(10, 500)
    ctx.fillStyle = c.ok
    ctx.fillText('IN TIME', kx + 12, okY)
    ctx.fillStyle = c.muted
    ctx.fillText('TOO LATE', kx + 12, badY)
  }

  // Particles live in real time, so the animation's pace does not depend on the simulation's speed.
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i]
    const life = pt.kind === 'drop' || pt.kind === 'skip' ? 600 : 380
    const t = (now - pt.born) / life
    if (t >= 1) {
      particles.splice(i, 1)
      continue
    }
    let x: number
    let y: number
    let col: string
    const jy = (pt.jit - 0.5) * tubeH * 0.6
    if (pt.kind === 'arrive') {
      x = sx + 14 + (qx0 - sx - 14) * t
      y = cy + jy * t
      col = c.accent
    } else if (pt.kind === 'drop') {
      x = qx0 - 6 - 20 * t
      y = cy + jy * 0.3 + (h / 2 - 10) * t * t
      col = c.crit
    } else if (pt.kind === 'skip') {
      x = qx1 - 6 + 8 * t
      y = cy + (h / 2 - 10) * t * t
      col = c.zombie
    } else {
      const wp = wpos[pt.worker ?? 0] ?? { x: wx1, y: cy }
      const ty = pt.kind === 'ok' ? okY : badY
      x = wp.x + (kx - 8 - wp.x) * t
      y = wp.y + (ty - wp.y) * t
      col = pt.kind === 'ok' ? c.ok : c.zombie
    }
    ctx.globalAlpha = 1 - t * 0.6
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ---------- Strip charts ----------

type Tone = 'ink' | 'muted' | 'accent' | 'ok' | 'warn' | 'crit'

interface Series {
  get: (s: Sample) => number
  tone: Tone
  label: string
  width?: number
  dash?: number[]
  area?: boolean
  dot?: boolean
}

interface ChartSpec {
  title: string
  fmt: (v: number) => string
  series: Series[]
  refs?: { get: (sim: Simulation) => number; tone: Tone; label: string }[]
  log?: { min: number; max: number; ticks: number[] }
}

export const CHARTS: Record<ChartId, ChartSpec> = {
  throughput: {
    title: 'THROUGHPUT',
    fmt: (v) => `${fmtRate(v)}/S`,
    series: [
      { get: (s) => s.cap, tone: 'muted', label: 'capacity', dash: [4, 3], width: 1.2 },
      { get: (s) => s.offered, tone: 'accent', label: 'offered incl. retries', dot: true },
      { get: (s) => s.good, tone: 'ok', label: 'goodput', width: 2, dot: true },
    ],
  },
  depth: {
    title: 'QUEUE DEPTH',
    fmt: fmtCount,
    series: [{ get: (s) => s.depth, tone: 'accent', label: 'queued', area: true, dot: true }],
  },
  backlog: {
    title: 'BACKLOG',
    fmt: fmtCount,
    series: [
      { get: (s) => s.held, tone: 'warn', label: 'blocked upstream', area: true, dot: true },
      { get: (s) => s.depth, tone: 'accent', label: 'queued at the server', area: true, dot: true },
    ],
  },
  latency: {
    title: 'SERVER LATENCY',
    fmt: fmtSeconds,
    log: { min: 0.001, max: 100, ticks: [0.001, 0.01, 0.1, 1, 10, 100] },
    series: [
      { get: (s) => s.p50, tone: 'muted', label: 'p50', width: 1.2 },
      { get: (s) => s.p99, tone: 'accent', label: 'p99', dot: true },
    ],
    refs: [
      {
        get: (sim) => (sim.params.timeoutMs >= 3_600_000 ? Number.NaN : sim.params.timeoutMs / 1000),
        tone: 'crit',
        label: 'client timeout',
      },
    ],
  },
}

const niceMax = (v: number) => {
  if (!(v > 0)) return 1
  const e = 10 ** Math.floor(Math.log10(v))
  const f = v / e
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e
}

export function drawChart(cv: HTMLCanvasElement, sim: Simulation, spec: ChartSpec, c: Palette) {
  const { ctx, w, h } = fit(cv)
  ctx.clearRect(0, 0, w, h)
  const pad = { l: 56, r: 10, t: 6, b: 18 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const samples = sim.samples
  const tEnd = Math.max(60, sim.t)
  const tStart = tEnd - 60
  const X = (t: number) => pad.l + ((t - tStart) / 60) * pw
  let Y: (v: number) => number
  let ticks: number[]
  const log = spec.log
  if (log) {
    const lo = Math.log10(log.min)
    const hi = Math.log10(log.max)
    Y = (v) => pad.t + ph - ((Math.log10(Math.max(log.min, Math.min(log.max, v))) - lo) / (hi - lo)) * ph
    ticks = log.ticks
  } else {
    let mx = 0
    for (const s of samples)
      for (const ser of spec.series) {
        const v = ser.get(s)
        if (Number.isFinite(v) && v > mx) mx = v
      }
    const top = niceMax(mx * 1.08)
    Y = (v) => pad.t + ph - Math.min(1, v / top) * ph
    ticks = [0, top / 2, top]
  }
  ctx.font = `400 10.5px ${c.font}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  ctx.strokeStyle = c.rule
  ctx.lineWidth = 1
  for (const tv of ticks) {
    const y = Math.round(Y(tv)) + 0.5
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(w - pad.r, y)
    ctx.stroke()
    ctx.fillStyle = c.muted
    ctx.fillText(spec.fmt(tv), pad.l - 6, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  for (let k = 0; k <= 6; k++) {
    const x = X(tStart + k * 10)
    ctx.fillStyle = c.muted
    ctx.fillText(k === 6 ? `${Math.floor(tEnd)} S` : `−${60 - k * 10}`, Math.min(w - pad.r - 14, x), h - 4)
  }
  // Disturbance bands
  ctx.globalAlpha = 0.1
  for (const s of samples) {
    if (s.t < tStart || !(s.spiking || s.slowing)) continue
    ctx.fillStyle = s.spiking ? c.warn : c.crit
    ctx.fillRect(X(s.t - SAMPLE_SECONDS), pad.t, Math.max(1, (pw * SAMPLE_SECONDS) / 60), ph)
  }
  ctx.globalAlpha = 1
  for (const ref of spec.refs ?? []) {
    const v = ref.get(sim)
    if (!Number.isFinite(v)) continue
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = c[ref.tone]
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(pad.l, Y(v))
    ctx.lineTo(w - pad.r, Y(v))
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const ser of spec.series) {
    ctx.strokeStyle = c[ser.tone]
    ctx.lineWidth = ser.width ?? 1.6
    if (ser.dash) ctx.setLineDash(ser.dash)
    ctx.beginPath()
    let started = false
    let lastX = 0
    let lastY = 0
    let firstX = 0
    for (const s of samples) {
      if (s.t < tStart) continue
      const v = ser.get(s)
      if (!Number.isFinite(v)) {
        started = false
        continue
      }
      const x = X(s.t)
      const y = Y(v)
      if (!started) {
        ctx.moveTo(x, y)
        if (!lastX) firstX = x
        started = true
      } else ctx.lineTo(x, y)
      lastX = x
      lastY = y
    }
    ctx.stroke()
    ctx.setLineDash([])
    if (ser.area && lastX) {
      ctx.lineTo(lastX, pad.t + ph)
      ctx.lineTo(firstX, pad.t + ph)
      ctx.closePath()
      ctx.globalAlpha = 0.12
      ctx.fillStyle = c[ser.tone]
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (started && ser.dot) {
      ctx.beginPath()
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2)
      ctx.fillStyle = c[ser.tone]
      ctx.fill()
    }
  }
}
