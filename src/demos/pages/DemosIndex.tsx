import { ArrowRight } from 'lucide-react'
import { SiteShell } from '../../components/SiteShell'
import { TagList } from '../../components/TagList'
import { CATALOGUE, type CatalogueEntry, DEMO_GROUPS, demoPath } from '../catalogue.ts'
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
      {DEMO_GROUPS.map((group) => (
        <section key={group.id} className="demos-group" aria-labelledby={`group-${group.id}`}>
          <header className="demos-group-header">
            <h2 id={`group-${group.id}`}>
              <span>{'//'}</span> {group.title}
            </h2>
            <p>{group.blurb}</p>
          </header>
          {/* Numbered across the whole index, so the list position matches the number on the card. */}
          <ol className="demos-cards" start={CATALOGUE.indexOf(group.demos[0]) + 1}>
            {group.demos.map((entry) => (
              <DemoCard key={entry.slug} entry={entry} />
            ))}
          </ol>
        </section>
      ))}
    </SiteShell>
  )
}

/** Numbered across the whole index, so a demo keeps its number whichever group it is in. */
function DemoCard({ entry }: { entry: CatalogueEntry }) {
  return (
    <li className="panel demos-card">
      <a href={demoPath(entry.slug)}>
        <span className="demos-card-meta">
          <span>{String(CATALOGUE.indexOf(entry) + 1).padStart(2, '0')}</span>
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
  )
}
