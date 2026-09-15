import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { PanelHeader } from './PanelHeader'
import './ControlsPanel.css'

interface ControlsPanelProps {
  labOpen: boolean
  onToggleLab: () => void
  logOpen: boolean
  onToggleLog: () => void
}

export function ControlsPanel({ labOpen, onToggleLab, logOpen, onToggleLog }: ControlsPanelProps) {
  return (
    <section className="panel controls-panel" aria-labelledby="controls-title">
      <PanelHeader id="controls-title" title="CONTROLS" />
      <div className="control-list">
        <button
          type="button"
          className="control-toggle"
          onClick={onToggleLab}
          aria-expanded={labOpen}
          aria-controls="fault-lab-body"
        >
          {labOpen ? 'CLOSE FAULT LAB' : 'OPEN FAULT LAB'}
          {labOpen ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
        </button>
        <button type="button" className="control-toggle" onClick={onToggleLog} aria-expanded={logOpen}>
          {logOpen ? 'HIDE EVENT LOG' : 'VIEW EVENT LOG'}
          {logOpen ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
        </button>
      </div>
    </section>
  )
}
