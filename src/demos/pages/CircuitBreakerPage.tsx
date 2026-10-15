import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { EventLog } from '../../components/EventLog'
import { FaultLab } from '../../components/FaultLab'
import { ServiceWorkerPanel } from '../../components/ServiceWorkerPanel'
import { SiteShell } from '../../components/SiteShell'
import { TagList } from '../../components/TagList'
import { DEMOS_PATH } from '../../content'
import { CIRCUIT_BREAKER } from '../catalogue.ts'
import './Demos.css'

export function CircuitBreakerPage() {
  // Open on arrival: this page exists to run it. Collapsing stops the status client polling.
  const [labOpen, setLabOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  return (
    <SiteShell page="demos">
      <section className="demos-intro" aria-labelledby="demos-title">
        <div className="demos-intro-copy">
          <a className="demos-kicker" href={DEMOS_PATH}>
            {'// DEMOS'}
          </a>
          <h1 id="demos-title">{CIRCUIT_BREAKER.title}</h1>
          <p>{CIRCUIT_BREAKER.question}</p>
          <p>{CIRCUIT_BREAKER.summary}</p>
          <div className="demos-intro-actions">
            <span className="demos-kind kind-live">LIVE</span>
            <TagList tags={CIRCUIT_BREAKER.tags} />
          </div>
          <button
            type="button"
            className="button-secondary demos-log-toggle"
            onClick={() => setLogOpen((open) => !open)}
            aria-expanded={logOpen}
          >
            {logOpen ? 'HIDE EVENT LOG' : 'VIEW EVENT LOG'}
            {logOpen ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          </button>
        </div>
        {/* The demo runs through this worker: its state, and UPGRADE when a new one is waiting, belong beside it. */}
        <ServiceWorkerPanel />
      </section>
      <FaultLab open={labOpen} onToggle={() => setLabOpen((open) => !open)} />
      {logOpen && <EventLog />}
    </SiteShell>
  )
}
