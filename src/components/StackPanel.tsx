import { Zap } from 'lucide-react'
import { stack } from '../content'
import { PanelHeader } from './PanelHeader'
import './StackPanel.css'

export function StackPanel() {
  return (
    <section className="panel stack-panel" id="skills" aria-labelledby="stack-title">
      <PanelHeader id="stack-title" title="TECH_STACK" />
      <div className="stack-grid">
        {stack.map((item) => (
          <div className="stack-item" key={item.name}>
            <span className={`stack-mark ${item.color}`}>
              {/* The ⚡ character renders as a colour emoji on some platforms; draw the bolt instead. */}
              {item.mark === 'bolt' ? <Zap size={26} strokeWidth={2.2} aria-hidden="true" /> : item.mark}
            </span>
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
