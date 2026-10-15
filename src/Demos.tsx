import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EventLog } from './components/EventLog'
import { FaultLab } from './components/FaultLab'
import { ServiceWorkerPanel } from './components/ServiceWorkerPanel'
import { SiteShell } from './components/SiteShell'
import { TagList } from './components/TagList'
import { demos } from './content'
import './Demos.css'

const LAB_HASH = '#fault-lab'

export function Demos() {
  // Open on arrival: this page exists to run it. Collapsing stops the status client polling.
  const [labOpen, setLabOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash === LAB_HASH) setLabOpen(true)
    }
    // hashchange does not fire when the hash is already #fault-lab, so catch the link clicks too.
    const openOnLink = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`a[href="${LAB_HASH}"]`)) setLabOpen(true)
    }
    window.addEventListener('hashchange', openOnHash)
    document.addEventListener('click', openOnLink)
    return () => {
      window.removeEventListener('hashchange', openOnHash)
      document.removeEventListener('click', openOnLink)
    }
  }, [])

  return (
    <SiteShell page="demos">
      <section className="demos-intro" aria-labelledby="demos-title">
        <div className="demos-intro-copy">
          <div className="demos-kicker">{'// SRE_DEMOS();'}</div>
          <h1 id="demos-title">DEMOS</h1>
          <p>
            Reliability patterns you can break on purpose. Everything runs in your browser: faults are injected locally,
            so the real systems stay healthy for everyone else.
          </p>
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
        <nav className="panel demos-index" aria-labelledby="demos-index-title">
          <h2 id="demos-index-title">
            <span>{'//'}</span> INDEX
          </h2>
          <ol>
            {demos.map((demo) => (
              <li key={demo.id}>
                <a href={`#${demo.id}`}>
                  <span className="demos-index-title">
                    <ChevronRight size={13} /> {demo.title}
                  </span>
                  <span className="demos-index-summary">{demo.summary}</span>
                  <TagList tags={demo.tags} />
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {/* The demos run through this worker: its state, and UPGRADE when a new one is waiting, belong beside them. */}
        <ServiceWorkerPanel />
      </section>
      <FaultLab open={labOpen} onToggle={() => setLabOpen((open) => !open)} />
      {logOpen && <EventLog />}
    </SiteShell>
  )
}
