import { ArrowRight } from 'lucide-react'
import { SiteShell } from '../../components/SiteShell'
import { TagList } from '../../components/TagList'
import { CATALOGUE, demoPath } from '../catalogue.ts'
import './Demos.css'

export function DemosIndex() {
  return (
    <SiteShell page="demos">
      <section className="demos-intro" aria-labelledby="demos-title">
        <div className="demos-intro-copy">
          <div className="demos-kicker">{'// SRE_DEMOS();'}</div>
          <h1 id="demos-title">DEMOS</h1>
          <p>
            Reliability patterns that are hard to reason about until you can push on them. Each demo is one idea, with
            only the controls that idea depends on. Simulations are seeded, so a scenario plays out the same way every
            time; the live demo breaks real requests, in your browser only.
          </p>
        </div>
      </section>
      <ol className="demos-cards">
        {CATALOGUE.map((entry, index) => (
          <li key={entry.slug} className="panel demos-card">
            <a href={demoPath(entry.slug)}>
              <span className="demos-card-meta">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span className={`demos-kind kind-${entry.kind}`}>{entry.kind === 'live' ? 'LIVE' : 'SIMULATED'}</span>
              </span>
              <span className="demos-card-title">{entry.title}</span>
              <span className="demos-card-question">{entry.question}</span>
              <span className="demos-card-summary">{entry.summary}</span>
              <TagList tags={entry.tags} />
              <span className="demos-card-open">
                OPEN <ArrowRight size={14} />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </SiteShell>
  )
}
