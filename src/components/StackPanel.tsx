import { stack } from '../content'
import { PanelHeader } from './PanelHeader'

export function StackPanel() {
  return (
    <section className="panel stack-panel" id="skills" aria-labelledby="stack-title">
      <PanelHeader id="stack-title" title="TECH_STACK" />
      <div className="stack-grid">
        {stack.map((item) => (
          <div className="stack-item" key={item.name}>
            <span className={`stack-mark ${item.color}`}>{item.mark}</span>
            <span>{item.name}</span>
          </div>
        ))}
      </div>
      <div className="stack-quote">
        <span>“</span>
        <p>
          GOOD TOOLS
          <br />
          BETTER IDEAS
        </p>
        <span className="quote-rule">—</span>
      </div>
    </section>
  )
}
