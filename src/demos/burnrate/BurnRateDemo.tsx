import { Pause, Play } from 'lucide-react'
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelHeader } from '../../components/PanelHeader'
import { TagList } from '../../components/TagList'
import { DEMOS_PATH } from '../../content'
import { DEMO_SEED } from '../definition.ts'
import { type Palette, readPalette } from '../ui/canvas.ts'
import { BURN_RATE, SCENARIOS, type Scenario } from './demo.ts'
import {
  BASELINE,
  burnRate,
  type Curve,
  DAY,
  DEFAULT_SETTINGS,
  incidentSpend,
  noise,
  REQUESTS_PER_MINUTE,
  type RuleId,
  type RuleSummary,
  ratio,
  type Settings,
  SLO_DAYS,
  SLO_TARGETS,
  simulate,
  summarise,
  THRESHOLD_WINDOW,
  THRESHOLDS,
  TIERS,
  type Verdict,
  WORTH_A_PAGE,
} from './model.ts'
import { clock, drawTimeline, fmtRatio, layout, minuteAt, rateAt } from './timeline.ts'
import '../ui/SimulatedDemo.css'
import './BurnRate.css'

type Speed = 1 | 3 | 10
const SPEEDS: Speed[] = [1, 3, 10]
/** Simulated minutes per real second at 1x: a day in 24 seconds. */
const MINUTES_PER_SECOND = 60

const RULES: readonly { id: RuleId; label: string; rule: (s: Settings) => string }[] = [
  {
    id: 'threshold',
    label: 'FIXED THRESHOLD',
    rule: (s) => `Errors over the last ${THRESHOLD_WINDOW} min above ${fmtRatio(s.threshold)}.`,
  },
  { id: 'single', label: 'SINGLE BURN RATE', rule: () => `Burn rate over the last hour at least ${TIERS[0].burn}×.` },
  {
    id: 'multi',
    label: 'MULTI-WINDOW',
    rule: () => `1 h and 5 min both at least ${TIERS[0].burn}×, or 6 h and 30 min both at least ${TIERS[1].burn}×.`,
  },
]

const VERDICTS: Record<Verdict, { label: string; tone: 'ok' | 'warn' | 'crit' }> = {
  caught: { label: 'CAUGHT IT', tone: 'ok' },
  quiet: { label: 'RIGHTLY QUIET', tone: 'ok' },
  noise: { label: 'PAGED FOR NOTHING', tone: 'warn' },
  flapping: { label: 'FLAPPING', tone: 'warn' },
  missed: { label: 'MISSED IT', tone: 'crit' },
}

const fmtSlo = (slo: number) => `${(slo * 100).toFixed(slo >= 0.9995 ? 2 : slo >= 0.995 ? 1 : 0)}%`
const fmtMinutes = (m: number) => (m < 60 ? `${m} MIN` : `${Math.floor(m / 60)} H ${m % 60} MIN`)
const fmtBurn = (b: number) => (b >= 100 ? `${Math.round(b)}×` : `${b.toFixed(1)}×`)

function describe(s: RuleSummary, incident: { start: number } | null): string {
  if (s.first === null) return 'NEVER FIRED'
  const pages = `${s.pages} PAGE${s.pages === 1 ? '' : 'S'}`
  const first = incident && s.first >= incident.start ? ` · ${fmtMinutes(s.first + 1 - incident.start)} IN` : ''
  const clears = s.stillFiring
    ? ' · STILL FIRING AT MIDNIGHT'
    : s.clearsAfter !== null
      ? ` · CLEARS ${fmtMinutes(s.clearsAfter)} AFTER`
      : ''
  return `${pages} · FIRST ${clock(s.first + 1)}${first}${clears}`
}

/**
 * The SLO burn-rate demo: a day of traffic whose error rate you draw, three alerting rules judged against it, and a
 * cursor that replays the day so you can see each window's value at the minute a rule fired or cleared.
 */
export function BurnRateDemo() {
  const [scenarioId, setScenarioId] = useState<string | null>(SCENARIOS[0].id)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [curve, setCurve] = useState<Curve>(() => SCENARIOS[0].curve())
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<Speed>(1)
  const z = useMemo(() => noise(DEMO_SEED), [])
  const day = useMemo(() => simulate(curve, settings, z), [curve, settings, z])
  const summaries = useMemo(
    () => Object.fromEntries(RULES.map((r) => [r.id, summarise(day, r.id)])) as Record<RuleId, RuleSummary>,
    [day],
  )
  const rootRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pen = useRef<{ minute: number; rate: number } | null>(null)
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)

  /** Replay the day from midnight, or with reduced motion, show all of it at once. */
  const restart = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setCursor(reduced ? DAY - 1 : 0)
    setPlaying(!reduced)
  }, [])

  useEffect(restart, [restart])

  const load = (s: Scenario) => {
    setScenarioId(s.id)
    setCurve(s.curve())
    restart()
  }

  // Replay: the cursor sweeps the day, and stops at midnight.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      if (!document.hidden) {
        setCursor((m) => Math.min(DAY - 1, m + dt * MINUTES_PER_SECOND * speed))
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

  useEffect(() => {
    if (cursor >= DAY - 1) setPlaying(false)
  }, [cursor])

  const draw = useCallback(() => {
    const cv = canvasRef.current
    const root = rootRef.current
    if (!cv || !root) return
    const palette: Palette = readPalette(root)
    const height = `${layout(cv.getBoundingClientRect().width).height}px`
    if (cv.style.height !== height) cv.style.height = height
    drawTimeline(cv, day, palette, Math.floor(cursor))
  }, [day, cursor])

  useEffect(draw, [draw])
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(cv)
    return () => observer.disconnect()
  }, [draw])

  // ---------- Drawing ----------

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    const l = layout(r.width)
    const x = event.clientX - r.left
    const y = event.clientY - r.top
    const rate = rateAt(l, y)
    return { l, y, minute: minuteAt(l, x), rate: rate < BASELINE * 1.5 ? BASELINE : rate }
  }

  const paint = (to: { minute: number; rate: number }) => {
    const from = pen.current ?? to
    setCurve((prev) => {
      const next = new Float64Array(prev)
      const lo = Math.min(from.minute, to.minute)
      const hi = Math.max(from.minute, to.minute)
      for (let m = lo; m <= hi; m++) {
        const f = hi === lo ? 1 : (m - from.minute) / (to.minute - from.minute)
        // Interpolated in log space, as the axis is.
        next[m] = 10 ** (Math.log10(from.rate) + f * (Math.log10(to.rate) - Math.log10(from.rate)))
      }
      return next
    })
    pen.current = to
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const p = point(event)
    if (p.y < p.l.plot.top - 6 || p.y > p.l.plot.bottom + 6) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScenarioId(null)
    setPlaying(false)
    pen.current = null
    paint(p)
    setCursor(DAY - 1)
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const p = point(event)
    if (pen.current) paint(p)
    else if (!playing) setCursor(p.minute)
  }

  const onPointerUp = () => {
    if (!pen.current) return
    pen.current = null
    setCursor(DAY - 1)
  }

  // ---------- At the cursor ----------

  const m = Math.floor(cursor)
  const b = (minutes: number) => burnRate(day, m, minutes)
  const why: { label: string; conditions: { text: string; met: boolean }[]; firing: boolean }[] = [
    {
      label: 'FIXED THRESHOLD',
      conditions: [
        {
          text: `5 MIN ${fmtRatio(ratio(day, m, THRESHOLD_WINDOW))} > ${fmtRatio(settings.threshold)}`,
          met: day.firing.threshold[m] === 1,
        },
      ],
      firing: day.firing.threshold[m] === 1,
    },
    {
      label: 'SINGLE BURN RATE',
      conditions: [{ text: `1 H ${fmtBurn(b(60))} ≥ ${TIERS[0].burn}×`, met: b(60) >= TIERS[0].burn }],
      firing: day.firing.single[m] === 1,
    },
    ...TIERS.map((tier) => ({
      label: `MULTI-WINDOW · ${tier.id.toUpperCase()}`,
      conditions: [tier.long, tier.short].map((minutes) => ({
        text: `${minutes >= 60 ? `${minutes / 60} H` : `${minutes} MIN`} ${fmtBurn(b(minutes))} ≥ ${tier.burn}×`,
        met: b(minutes) >= tier.burn,
      })),
      firing: day.tiers[tier.id][m] === 1,
    })),
  ]

  const spend = incidentSpend(day)

  return (
    <article className="sim-demo burn-demo" ref={rootRef} aria-labelledby="demo-title" data-testid="burn-demo">
      <header className="sim-header">
        <a className="sim-crumb" href={DEMOS_PATH}>
          {'// DEMOS'}
        </a>
        <h1 id="demo-title">{BURN_RATE.title}</h1>
        <p className="sim-question">{BURN_RATE.question}</p>
        <div className="sim-meta">
          <span className="sim-badge">SIMULATED · SEED {DEMO_SEED}</span>
          <TagList tags={BURN_RATE.tags} />
        </div>
      </header>

      <div className="sim-grid">
        <aside className="sim-rail">
          <section className="panel sim-group" aria-labelledby="presets-title">
            <PanelHeader id="presets-title" title="INCIDENTS" />
            <div className="sim-presets">
              {SCENARIOS.map((s) => (
                <button key={s.id} type="button" aria-pressed={s.id === scenarioId} onClick={() => load(s)}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="sim-preset-note" data-testid="preset-description">
              {scenario
                ? scenario.description
                : 'Your own drawing. Pick an incident to start one of the stories again.'}
            </p>
          </section>

          <section className="panel sim-group" aria-labelledby="controls-title">
            <PanelHeader id="controls-title" title="CONTROLS" />
            <div className="sim-controls">
              <div className="sim-control">
                <label htmlFor="control-slo">SLO TARGET</label>
                <select
                  id="control-slo"
                  value={settings.slo}
                  onChange={(event) => setSettings((s) => ({ ...s, slo: Number(event.target.value) }))}
                >
                  {SLO_TARGETS.map((slo) => (
                    <option key={slo} value={slo}>
                      {fmtSlo(slo)} OF REQUESTS
                    </option>
                  ))}
                </select>
                <small>
                  The error budget is what the SLO leaves over: {fmtRatio(1 - settings.slo)} of requests over {SLO_DAYS}{' '}
                  days. Burn rates are measured against it.
                </small>
              </div>
              <div className="sim-control">
                <label htmlFor="control-threshold">FIXED THRESHOLD</label>
                <select
                  id="control-threshold"
                  value={settings.threshold}
                  onChange={(event) => setSettings((s) => ({ ...s, threshold: Number(event.target.value) }))}
                >
                  {THRESHOLDS.map((t) => (
                    <option key={t} value={t}>
                      {fmtRatio(t)} OVER {THRESHOLD_WINDOW} MIN
                    </option>
                  ))}
                </select>
                <small>The error rate the plain alert pages at. Lower it to catch the leak, and count the pages.</small>
              </div>
            </div>
            <div className="sim-transport">
              <button
                type="button"
                onClick={() => {
                  if (cursor >= DAY - 1) setCursor(0)
                  setPlaying(!playing)
                }}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}{' '}
                {playing ? 'PAUSE' : cursor >= DAY - 1 ? 'REPLAY' : 'PLAY'}
              </button>
              <fieldset className="sim-speed">
                <legend>Replay speed</legend>
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </fieldset>
            </div>
            <div className="sim-control burn-scrub">
              <div className="sim-control-row">
                <label htmlFor="control-time">TIME</label>
                <output htmlFor="control-time" data-testid="burn-clock">
                  {clock(m + 1)}
                </output>
              </div>
              <input
                id="control-time"
                type="range"
                min={0}
                max={DAY - 1}
                step={1}
                value={m}
                onChange={(event) => {
                  setPlaying(false)
                  setCursor(Number(event.target.value))
                }}
              />
            </div>
            <p className="sim-held" data-testid="held-constant">
              <span>HELD CONSTANT</span> {REQUESTS_PER_MINUTE.toLocaleString('en-GB')} requests a minute ·{' '}
              {fmtRatio(BASELINE)} errors on a healthy day · a {SLO_DAYS}-day SLO window · tiers from the SRE workbook
            </p>
          </section>
        </aside>

        <div className="sim-stage">
          <div className="panel burn-timeline">
            <div className="sim-chart-head">
              <h2>ERROR RATE · DRAG TO DRAW</h2>
              <ul className="sim-legend">
                <li className="tone-accent">
                  <i /> drawn
                </li>
                <li className="tone-muted">
                  <i /> measured, 5 min
                </li>
                <li className="tone-accent">
                  <i className="burn-band" /> 1 h and 6 h windows
                </li>
                <li>log scale</li>
              </ul>
            </div>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="A day's error rate, the error budget it spends, and when each alert fired. Drag across the error rate to draw an incident."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>

          <div className="sim-readouts burn-verdicts" data-testid="readouts">
            <div className="sim-reading" data-testid="readout-spend">
              <span className="sim-reading-label">
                {day.incidents.length > 1 ? `COSTLIEST OF ${day.incidents.length} INCIDENTS` : 'INCIDENT COST'}
              </span>
              <span className="sim-reading-value">{(spend * 100).toFixed(1)}%</span>
              <span className="sim-reading-sub">
                OF THE MONTH'S BUDGET · WORTH A PAGE AT {Math.round(WORTH_A_PAGE * 100)}%
              </span>
            </div>
            {RULES.map((rule) => {
              const s = summaries[rule.id]
              const verdict = VERDICTS[s.verdict]
              return (
                <div className="sim-reading" key={rule.id} data-testid={`verdict-${rule.id}`}>
                  <span className="sim-reading-label">{rule.label}</span>
                  <span className={`sim-pill tone-${verdict.tone}`}>{verdict.label}</span>
                  <span className="sim-reading-sub">{describe(s, day.incident)}</span>
                  <span className="burn-rule">{rule.rule(settings)}</span>
                </div>
              )
            })}
          </div>

          <div className="panel burn-why">
            <div className="sim-chart-head">
              <h2>AT {clock(m + 1)}</h2>
              <span className="burn-why-note">
                Each window's burn rate: errors over the window, over the budget's share.
              </span>
            </div>
            <table data-testid="burn-why">
              <tbody>
                {why.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>
                      {row.conditions.map((c) => (
                        <span key={c.text} className={`burn-cond ${c.met ? 'met' : ''}`}>
                          {c.text}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={`sim-pill tone-${row.firing ? 'crit' : 'muted'}`}>
                        {row.firing ? 'FIRING' : 'QUIET'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section className="sim-takeaways" aria-label="What to take away">
        {BURN_RATE.takeaways.map((takeaway) => (
          <div key={takeaway.title}>
            <h2>{takeaway.title}</h2>
            <p>{takeaway.body}</p>
          </div>
        ))}
      </section>
    </article>
  )
}
