import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { FEATURED_PROJECTS, PROJECTS_PATH, type Project, projectNumber, projects } from '../content'
import { PanelHeader } from './PanelHeader'
import { ProjectImage } from './ProjectImage'
import { TagList } from './TagList'
import './ProjectsPanel.css'

export function ProjectsPanel({ onSelect }: { onSelect: (project: Project) => void }) {
  return (
    <section className="panel projects-panel" id="projects" aria-labelledby="projects-title">
      <PanelHeader id="projects-title" title="FEATURED_PROJECTS">
        <a className="panel-link" href={PROJECTS_PATH}>
          ALL PROJECTS <ArrowRight size={14} />
        </a>
      </PanelHeader>
      {/* The first few; the rest are on the projects page. */}
      <ul className="project-grid">
        {projects.slice(0, FEATURED_PROJECTS).map((project) => (
          <li key={project.slug}>
            <button
              type="button"
              className="project-card"
              onClick={() => onSelect(project)}
              aria-label={`Explore ${project.name}`}
            >
              <span className="project-image">
                <ProjectImage project={project} sizes="(max-width: 560px) 40vw, (max-width: 800px) 31vw, 18vw" />
                <span className="project-number">{projectNumber(project)}</span>
              </span>
              <span className="project-content">
                <span className="project-heading">
                  {project.name}
                  <ArrowUpRight size={23} strokeWidth={1.4} />
                </span>
                <span className="project-description">{project.description}</span>
                <TagList tags={project.tags} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
