// Canvas drawing for the burn-rate demo: one day on a shared time axis. The error rate (log scale, and the surface you
// draw on), the budget spent, and a lane per alert showing when it fired. Colours come from the --sim-* properties.
import { fit, type Palette } from '../ui/canvas.ts'
import {
  BASELINE,
  DAY,
  type Day,
  FLOOR,
  type RuleId,
  ratio,
  THRESHOLD_WINDOW,
  TIERS,
  type TierId,
  WORTH_A_PAGE,
} from './model.ts'

const LOG_MIN = Math.log10(FLOOR)
const LOG_MAX = 0
const RATE_TICKS = [0.0001, 0.001, 0.01, 0.1, 1]
const LANE_H = 26

export const LANES: readonly { id: RuleId | TierId; label: string }[] = [
  { id: 'threshold', label: 'FIXED THRESHOLD' },
  { id: 'single', label: 'SINGLE WINDOW · 1 H' },
  { id: 'fast', label: 'MULTI-WINDOW · FAST TIER' },
  { id: 'slow', label: 'MULTI-WINDOW · SLOW TIER' },
]

export interface Layout {
  x0: number
  x1: number
  /** The error-rate plot, which takes the pen. */
  plot: { top: number; bottom: number }
  budget: { top: number; bottom: number }
  lanes: number
  height: number
}

export function layout(w: number): Layout {
  const narrow = w < 560
  const x0 = narrow ? 44 : 56
  const x1 = w - 10
  const plot = { top: 10, bottom: narrow ? 180 : 210 }
  const budget = { top: plot.bottom + 42, bottom: plot.bottom + 42 + 56 }
  const lanes = budget.bottom + 26
  return { x0, x1, plot, budget, lanes, height: lanes + LANES.length * LANE_H + 4 }
}

export const minuteAt = (l: Layout, x: number) =>
  Math.max(0, Math.min(DAY - 1, Math.floor(((x - l.x0) / (l.x1 - l.x0)) * DAY)))

/** The error rate at a height on the plot, clamped to the axis. */
export function rateAt(l: Layout, y: number): number {
  const f = 1 - (y - l.plot.top) / (l.plot.bottom - l.plot.top)
  return 10 ** (LOG_MIN + Math.max(0, Math.min(1, f)) * (LOG_MAX - LOG_MIN))
}

export const fmtRatio = (r: number) =>
  !Number.isFinite(r)
    ? '—'
    : r >= 0.1
      ? `${Math.round(r * 100)}%`
      : r >= 0.01
        ? `${(r * 100).toFixed(1)}%`
        : `${(r * 100).toFixed(r >= 0.001 ? 2 : 3)}%`

export const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`

export function drawTimeline(cv: HTMLCanvasElement, day: Day, c: Palette, cursor: number) {
  const { ctx, w } = fit(cv)
  const l = layout(w)
  const h = l.height
  ctx.clearRect(0, 0, w, h)
  const font = (size: number, weight = 400) => `${weight} ${size}px ${c.font}`
  const X = (m: number) => l.x0 + (m / DAY) * (l.x1 - l.x0)
  const Y = (r: number) => {
    const v = Math.log10(Math.max(FLOOR, Math.min(1, r)))
    return l.plot.bottom - ((v - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (l.plot.bottom - l.plot.top)
  }
  const narrow = w < 560

  // The minutes above a healthy day's error rate, faint, behind everything.
  ctx.fillStyle = c.crit
  ctx.globalAlpha = 0.06
  for (let m = 0, from = -1; m <= DAY; m++) {
    const bad = m < DAY && day.curve[m] > BASELINE * 1.5
    if (bad && from < 0) from = m
    if (!bad && from >= 0) {
      ctx.fillRect(X(from), l.plot.top, Math.max(1, X(m) - X(from)), h - l.plot.top)
      from = -1
    }
  }
  ctx.globalAlpha = 1

  // The windows ending at the cursor: six hours, then one hour, shaded on the plot.
  for (const [minutes, alpha] of [
    [360, 0.07],
    [60, 0.12],
  ] as const) {
    const from = Math.max(0, cursor + 1 - minutes)
    ctx.fillStyle = c.accent
    ctx.globalAlpha = alpha
    ctx.fillRect(X(from), l.plot.top, X(cursor + 1) - X(from), l.plot.bottom - l.plot.top)
    ctx.globalAlpha = 1
  }

  // Measured: the error ratio over the threshold rule's five-minute window.
  ctx.strokeStyle = c.muted
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  for (let m = 0; m < DAY; m++) {
    const y = Y(ratio(day, m, THRESHOLD_WINDOW))
    if (m === 0) ctx.moveTo(X(m), y)
    else ctx.lineTo(X(m), y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1

  // Budget spent, as a share of the month's.
  const bMax = Math.max(0.1, day.spent[DAY - 1] * 1.15)
  const B = (s: number) => l.budget.bottom - (Math.min(s, bMax) / bMax) * (l.budget.bottom - l.budget.top)
  ctx.beginPath()
  ctx.moveTo(X(0), B(0))
  for (let m = 0; m < DAY; m++) ctx.lineTo(X(m + 1), B(day.spent[m]))
  ctx.lineTo(X(DAY), B(0))
  ctx.closePath()
  ctx.fillStyle = c.accent
  ctx.globalAlpha = 0.15
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = c.accent
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(X(0), B(0))
  for (let m = 0; m < DAY; m++) ctx.lineTo(X(m + 1), B(day.spent[m]))
  ctx.stroke()

  // A lane per alert, with a bar wherever it was firing.
  LANES.forEach((lane, i) => {
    const top = l.lanes + i * LANE_H + 14
    const series = lane.id === 'fast' || lane.id === 'slow' ? day.tiers[lane.id] : day.firing[lane.id]
    ctx.fillStyle = c.rule
    ctx.globalAlpha = 0.5
    ctx.fillRect(l.x0, top, l.x1 - l.x0, 8)
    ctx.globalAlpha = 1
    ctx.fillStyle = c.crit
    ctx.shadowColor = c.crit
    ctx.shadowBlur = 6
    let from = -1
    for (let m = 0; m <= DAY; m++) {
      const on = m < DAY && series[m] === 1
      if (on && from < 0) from = m
      if (!on && from >= 0) {
        ctx.fillRect(X(from), top, Math.max(2, X(m) - X(from)), 8)
        from = -1
      }
    }
    ctx.shadowBlur = 0
  })

  // Everything after the cursor fades back, so the day reads as it stood at that minute.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  ctx.globalAlpha = 0.65
  ctx.fillRect(X(cursor + 1), 0, w - X(cursor + 1), h)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // Labels for the budget strip and the lanes, which do not fade.
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(10, 500)
  ctx.fillStyle = c.muted
  ctx.fillText('BUDGET SPENT, SHARE OF THE MONTH', l.x0, l.budget.top - 12)
  ctx.strokeStyle = c.rule
  ctx.lineWidth = 1
  ctx.strokeRect(l.x0 + 0.5, l.budget.top + 0.5, l.x1 - l.x0 - 1, l.budget.bottom - l.budget.top)
  ctx.textAlign = 'right'
  ctx.font = font(10)
  ctx.fillText(`${Math.round(bMax * 100)}%`, l.x0 - 6, l.budget.top + 4)
  ctx.fillText('0%', l.x0 - 6, l.budget.bottom - 4)
  const yPage = Math.round(B(WORTH_A_PAGE)) + 0.5
  ctx.strokeStyle = c.warn
  ctx.setLineDash([4, 3])
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  ctx.moveTo(l.x0, yPage)
  ctx.lineTo(l.x1, yPage)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.fillStyle = c.warn
  ctx.font = font(9, 500)
  ctx.textBaseline = 'bottom'
  ctx.fillText(`WORTH A PAGE ${Math.round(WORTH_A_PAGE * 100)}%`, l.x1 - 2, yPage - 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = c.muted
  for (const [i, lane] of LANES.entries()) ctx.fillText(lane.label, l.x0, l.lanes + i * LANE_H + 6)

  // Grid and axes.
  ctx.lineWidth = 1
  ctx.textBaseline = 'middle'
  ctx.font = font(10)
  for (const tick of RATE_TICKS) {
    const y = Math.round(Y(tick)) + 0.5
    ctx.strokeStyle = c.rule
    ctx.beginPath()
    ctx.moveTo(l.x0, y)
    ctx.lineTo(l.x1, y)
    ctx.stroke()
    ctx.fillStyle = c.muted
    ctx.textAlign = 'right'
    ctx.fillText(fmtRatio(tick), l.x0 - 6, y)
  }
  ctx.textAlign = 'center'
  for (let hour = 0; hour <= 24; hour += narrow ? 6 : 3) {
    const x = X(hour * 60)
    ctx.fillStyle = c.muted
    ctx.textAlign = hour === 0 ? 'left' : hour === 24 ? 'right' : 'center'
    ctx.fillText(clock(hour * 60), x, l.plot.bottom + 12)
  }

  // Reference lines: the SLO, the burn rates the tiers need, and the fixed threshold.
  const refs: { rate: number; label: string; tone: string; left?: boolean }[] = [
    { rate: day.budgetRatio, label: 'SLO', tone: c.ok },
    { rate: day.budgetRatio * TIERS[1].burn, label: `${TIERS[1].burn}× BURN`, tone: c.crit },
    { rate: day.budgetRatio * TIERS[0].burn, label: `${TIERS[0].burn}× BURN`, tone: c.crit },
    { rate: day.settings.threshold, label: 'THRESHOLD', tone: c.warn, left: true },
  ]
  ctx.setLineDash([4, 3])
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.font = font(9, 500)
  for (const ref of refs) {
    if (ref.rate > 1) continue
    const y = Math.round(Y(ref.rate)) + 0.5
    ctx.strokeStyle = ref.tone
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(l.x0, y)
    ctx.lineTo(l.x1, y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.setLineDash([])

  // The drawn curve, the rate requests actually fail at.
  ctx.strokeStyle = c.accent
  ctx.lineWidth = 2
  ctx.shadowColor = c.accent
  ctx.shadowBlur = 6
  ctx.beginPath()
  for (let m = 0; m < DAY; m++) {
    const y = Y(day.curve[m])
    if (m === 0) ctx.moveTo(X(m), y)
    else {
      ctx.lineTo(X(m), Y(day.curve[m - 1]))
      ctx.lineTo(X(m), y)
    }
  }
  ctx.lineTo(X(DAY), Y(day.curve[DAY - 1]))
  ctx.stroke()
  ctx.shadowBlur = 0

  // The reference lines' labels, over the curve, outlined so a line through them does not hide them.
  ctx.font = font(9, 500)
  ctx.textBaseline = 'bottom'
  ctx.lineWidth = 3
  ctx.strokeStyle = '#070b18'
  for (const ref of refs) {
    if (ref.rate > 1) continue
    const y = Math.round(Y(ref.rate)) - 0.5
    const text = `${ref.label} ${fmtRatio(ref.rate)}`
    const x = ref.left ? l.x0 + 4 : l.x1 - 2
    ctx.textAlign = ref.left ? 'left' : 'right'
    ctx.strokeText(text, x, y)
    ctx.fillStyle = ref.tone
    ctx.fillText(text, x, y)
  }

  // The cursor, through everything.
  const cx = Math.round(X(cursor + 1)) + 0.5
  ctx.strokeStyle = c.ink
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, l.plot.top)
  ctx.lineTo(cx, h - 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = c.ink
  ctx.font = font(10, 500)
  ctx.textBaseline = 'top'
  ctx.textAlign = cx > l.x1 - 50 ? 'right' : 'left'
  ctx.fillText(clock(cursor + 1), cx + (ctx.textAlign === 'right' ? -4 : 4), l.plot.top + 2)
}
