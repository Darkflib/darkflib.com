import { ArrowUpRight } from 'lucide-react'
import { ProjectImage } from '../components/ProjectImage'
import { SiteShell } from '../components/SiteShell'
import { TagList } from '../components/TagList'
import { projectNumber, projects } from '../content'
import './ProjectsPage.css'

/** Every project, in full: the home page's cards open a dialog; here the detail is on the page, for reading and search. */
export function ProjectsPage() {
  return (
    <SiteShell page="projects">
      <section className="projects-intro" aria-labelledby="projects-title">
        <div className="projects-kicker">{'// PROJECTS();'}</div>
        <h1 id="projects-title">PROJECTS</h1>
        <p>Things I have built and run. Most are open source; the rest say so.</p>
      </section>
      <ol className="projects-list">
        {projects.map((project) => (
          <li key={project.slug} id={project.slug} className="panel project-entry">
            <div className="project-image">
              <ProjectImage project={project} sizes="(max-width: 800px) 100vw, 360px" />
              <span className="project-number">{projectNumber(project)}</span>
            </div>
            <div className="project-entry-copy">
              <h2>{project.name}</h2>
              <p className="project-entry-description">{project.description}</p>
              <p>{project.summary}</p>
              <TagList tags={project.tags} />
              {(project.links.live || project.links.source) && (
                <div className="project-entry-links">
                  {project.links.live && (
                    <a className="button-primary" href={project.links.live}>
                      OPEN <ArrowUpRight size={16} />
                    </a>
                  )}
                  {project.links.source && (
                    <a className="button-secondary" href={project.links.source}>
                      SOURCE <ArrowUpRight size={16} />
                    </a>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </SiteShell>
  )
}
