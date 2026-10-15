import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { DEMOS_PATH } from '../content'
import { PanelHeader } from './PanelHeader'
import './ControlsPanel.css'

interface ControlsPanelProps {
  logOpen: boolean
  onToggleLog: () => void
}

export function ControlsPanel({ logOpen, onToggleLog }: ControlsPanelProps) {
  return (
    <section className="panel controls-panel" aria-labelledby="controls-title">
      <PanelHeader id="controls-title" title="CONTROLS" />
      <div className="control-list">
        <a className="control-toggle" href={`${DEMOS_PATH}#fault-lab`}>
          OPEN FAULT LAB <ArrowRight size={15} />
        </a>
        <button type="button" className="control-toggle" onClick={onToggleLog} aria-expanded={logOpen}>
          {logOpen ? 'HIDE EVENT LOG' : 'VIEW EVENT LOG'}
          {logOpen ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
        </button>
      </div>
    </section>
  )
}
