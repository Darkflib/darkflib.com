import { ArrowRight } from 'lucide-react'
import { DEMOS_PATH } from '../content'
import { PanelHeader } from './PanelHeader'
import './ControlsPanel.css'

export function ControlsPanel() {
  return (
    <section className="panel controls-panel" aria-labelledby="controls-title">
      <PanelHeader id="controls-title" title="CONTROLS" />
      <div className="control-list">
        <a className="control-toggle" href={`${DEMOS_PATH}circuit-breaker/`}>
          OPEN FAULT LAB <ArrowRight size={15} />
        </a>
        <a className="control-toggle" href={DEMOS_PATH}>
          ALL DEMOS <ArrowRight size={15} />
        </a>
      </div>
    </section>
  )
}
