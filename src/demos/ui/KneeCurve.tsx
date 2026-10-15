import type { Params, Variability } from '../engine/params.ts'
import { utilisation } from '../engine/params.ts'
import { theoreticalWait } from '../engine/theory.ts'
import { fmtPercent, fmtSeconds } from '../registry.ts'

const RHO_MIN = 0.3
const RHO_MAX = 0.98
const WAIT_MIN = 0.0005
const WAIT_MAX = 10
const W = 420
const H = 220
const PAD = { l: 52, r: 12, t: 12, b: 30 }
const SHAPES: { id: Variability; label: string }[] = [
  { id: 'low', label: 'TIGHT' },
  { id: 'exp', label: 'EXPONENTIAL' },
  { id: 'heavy', label: 'HEAVY TAIL' },
]

const x = (rho: number) => PAD.l + ((rho - RHO_MIN) / (RHO_MAX - RHO_MIN)) * (W - PAD.l - PAD.r)
const y = (wait: number) => {
  const lo = Math.log10(WAIT_MIN)
  const hi = Math.log10(WAIT_MAX)
  const v = Math.log10(Math.max(WAIT_MIN, Math.min(WAIT_MAX, wait)))
  return H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
}

function curve(params: Params, variability: Variability): string {
  const points: string[] = []
  for (let rho = RHO_MIN; rho <= RHO_MAX + 1e-9; rho += 0.005) {
    const wait = theoreticalWait({ ...params, variability, lambda: (rho * params.workers) / (params.svcMs / 1000) })
    points.push(`${x(rho).toFixed(1)},${y(wait).toFixed(1)}`)
  }
  return `M${points.join('L')}`
}

/**
 * Theory's queue wait against utilisation for each service-time shape, with the live system on it: the hollow mark is
 * where theory puts the current settings, the filled one is what the simulation has measured since the last change.
 */
export function KneeCurve({ params, measured }: { params: Params; measured: number }) {
  const rho = utilisation(params)
  const theory = theoreticalWait(params)
  return (
    <figure className="knee-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="knee-curve-title knee-curve-caption">
        <title id="knee-curve-title">Queue wait against utilisation</title>
        {[0.001, 0.01, 0.1, 1, 10].map((tick) => (
          <g key={tick} className="knee-grid">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(tick)} y2={y(tick)} />
            <text x={PAD.l - 6} y={y(tick)}>
              {fmtSeconds(tick)}
            </text>
          </g>
        ))}
        {[0.3, 0.5, 0.7, 0.9].map((tick) => (
          <text key={tick} className="knee-axis" x={x(tick)} y={H - 10}>
            {fmtPercent(tick)}
          </text>
        ))}
        {SHAPES.map((shape) => (
          <path
            key={shape.id}
            d={curve(params, shape.id)}
            className={shape.id === params.variability ? 'knee-line current' : 'knee-line'}
          />
        ))}
        <line className="knee-marker" x1={x(rho)} x2={x(rho)} y1={PAD.t} y2={H - PAD.b} />
        {Number.isFinite(theory) && <circle className="knee-theory" cx={x(rho)} cy={y(theory)} r={5} />}
        {Number.isFinite(measured) && <circle className="knee-measured" cx={x(rho)} cy={y(measured)} r={4} />}
      </svg>
      <figcaption id="knee-curve-caption">
        Mean queue wait against utilisation, log scale. Lines are theory for each service-time shape (bright: the
        current one); <span className="knee-key-theory">○</span> theory at {fmtPercent(rho)},{' '}
        <span className="knee-key-measured">●</span> measured since the last change.
      </figcaption>
    </figure>
  )
}
