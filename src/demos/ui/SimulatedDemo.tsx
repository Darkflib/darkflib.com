import { Pause, Play, RotateCcw, Zap } from 'lucide-react'
import { PanelHeader } from '../../components/PanelHeader'
import { TagList } from '../../components/TagList'
import { DEMOS_PATH } from '../../content'
import type { DemoDefinition } from '../definition.ts'
import { CONTROLS, HELD, READOUTS } from '../registry.ts'
import { CHARTS } from './canvas.ts'
import { KneeCurve } from './KneeCurve'
import { type Speed, useSimulation } from './useSimulation'
import './SimulatedDemo.css'

const SPEEDS: Speed[] = [1, 3, 10]
const ACTION_LABELS = { spike: 'INJECT SPIKE', slow: 'SLOW DEPENDENCY', surge: 'DOUBLE THE LOAD' } as const
const ACTION_HELP = {
  spike: 'Double the arrival rate for 5 simulated seconds.',
  surge: 'Double the arrival rate for 30 simulated seconds.',
  slow: 'Triple service time for 10 simulated seconds.',
} as const

/** One concept, rendered from its definition: presets, the few controls it exposes, the live system, and the lesson. */
export function SimulatedDemo({ def }: { def: DemoDefinition }) {
  const demo = useSimulation(def)
  const { sim } = demo
  const m = sim.latest
  const preset = def.presets.find((p) => p.id === demo.presetId)

  return (
    <article className="sim-demo" ref={demo.rootRef} aria-labelledby="demo-title" data-testid="sim-demo">
      <header className="sim-header">
        <a className="sim-crumb" href={DEMOS_PATH}>
          {'// DEMOS'}
        </a>
        <h1 id="demo-title">{def.title}</h1>
        <p className="sim-question">{def.question}</p>
        <div className="sim-meta">
          <span className="sim-badge">SIMULATED · SEED 1</span>
          <TagList tags={def.tags} />
        </div>
      </header>

      <div className="sim-grid">
        <aside className="sim-rail">
          <section className="panel sim-group" aria-labelledby="presets-title">
            <PanelHeader id="presets-title" title="SCENARIOS" />
            <div className="sim-presets">
              {def.presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === demo.presetId}
                  onClick={() => demo.loadPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="sim-preset-note" data-testid="preset-description">
              {preset ? preset.description : 'Your own settings. Pick a scenario to start one of the stories again.'}
            </p>
          </section>

          <section className="panel sim-group" aria-labelledby="controls-title">
            <PanelHeader id="controls-title" title="CONTROLS" />
            <div className="sim-controls">
              {def.controls.map((id) => {
                const control = CONTROLS[id]
                const inputId = `control-${id}`
                if (control.kind === 'range') {
                  const value = control.get(sim.params)
                  return (
                    <div className="sim-control" key={id}>
                      <div className="sim-control-row">
                        <label htmlFor={inputId}>{control.label}</label>
                        <output htmlFor={inputId}>{control.format(value)}</output>
                      </div>
                      <input
                        id={inputId}
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={value}
                        onChange={(event) => demo.change(control.patch(Number(event.target.value), sim.params))}
                      />
                      <small>{control.help}</small>
                    </div>
                  )
                }
                if (control.kind === 'toggle') {
                  return (
                    <div className="sim-control sim-toggle" key={id}>
                      <label htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={control.get(sim.params)}
                          onChange={(event) => demo.change(control.patch(event.target.checked, sim.params))}
                        />
                        {control.label}
                      </label>
                      <small>{control.help}</small>
                    </div>
                  )
                }
                return (
                  <div className="sim-control" key={id}>
                    <label htmlFor={inputId}>{control.label}</label>
                    <select
                      id={inputId}
                      value={control.get(sim.params)}
                      onChange={(event) => demo.change(control.patch(event.target.value, sim.params))}
                    >
                      {control.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>{control.help}</small>
                  </div>
                )
              })}
              {def.actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className="sim-action"
                  title={ACTION_HELP[action]}
                  onClick={() => demo.disturb(action)}
                >
                  <Zap size={14} /> {ACTION_LABELS[action]}
                </button>
              ))}
            </div>
            <div className="sim-transport">
              <button type="button" onClick={() => demo.setRunning(!demo.running)}>
                {demo.running ? <Pause size={13} /> : <Play size={13} />} {demo.running ? 'PAUSE' : 'RUN'}
              </button>
              <fieldset className="sim-speed">
                <legend>Simulation speed</legend>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    aria-pressed={demo.speed === speed}
                    onClick={() => demo.setSpeed(speed)}
                  >
                    {speed}×
                  </button>
                ))}
              </fieldset>
              <button type="button" onClick={demo.reset}>
                <RotateCcw size={13} /> RESET
              </button>
            </div>
            <p className="sim-held" data-testid="held-constant">
              <span>HELD CONSTANT</span>{' '}
              {def.held.length
                ? def.held.map((id) => HELD[id](sim.params)).join(' · ')
                : 'nothing: every engine parameter is a control'}
            </p>
          </section>
        </aside>

        <div className="sim-stage">
          <div className="panel sim-pipeline">
            <canvas
              ref={demo.pipelineRef}
              role="img"
              aria-label="Requests flowing from clients through the queue to the workers"
            />
            <span className="sim-clock" data-testid="sim-clock">
              T+{sim.t.toFixed(1)} S
            </span>
          </div>

          <div className="sim-readouts" data-testid="readouts">
            {def.readouts.map((id) => {
              if (!m) return null
              const reading = READOUTS[id](sim, m)
              return (
                <div className="sim-reading" key={id} data-testid={`readout-${id}`}>
                  <span className="sim-reading-label">{reading.label}</span>
                  {reading.tone ? (
                    <span className={`sim-pill tone-${reading.tone}`}>{reading.value}</span>
                  ) : (
                    <span className="sim-reading-value">{reading.value}</span>
                  )}
                  <span className="sim-reading-sub">{reading.sub}</span>
                </div>
              )
            })}
          </div>

          {def.visual === 'knee-curve' && (
            <div className="panel sim-visual">
              <KneeCurve params={sim.params} measured={sim.epochWait} />
            </div>
          )}

          {def.charts.map((id) => {
            const spec = CHARTS[id]
            return (
              <div className="panel sim-chart" key={id}>
                <div className="sim-chart-head">
                  <h2>{spec.title}</h2>
                  <ul className="sim-legend">
                    {spec.series.map((series) => (
                      <li key={series.label} className={`tone-${series.tone}`}>
                        <i className={series.dash ? 'dash' : ''} /> {series.label}
                      </li>
                    ))}
                    {spec.refs?.map((ref) => (
                      <li key={ref.label} className={`tone-${ref.tone}`}>
                        <i className="dash" /> {ref.label}
                      </li>
                    ))}
                    {spec.log && <li>log scale</li>}
                  </ul>
                </div>
                <canvas
                  ref={demo.chartRef(id)}
                  role="img"
                  aria-label={`${spec.title.toLowerCase()} over the last minute`}
                />
              </div>
            )
          })}
        </div>
      </div>

      <section className="sim-takeaways" aria-label="What to take away">
        {def.takeaways.map((takeaway) => (
          <div key={takeaway.title}>
            <h2>{takeaway.title}</h2>
            <p>{takeaway.body}</p>
          </div>
        ))}
      </section>
    </article>
  )
}
