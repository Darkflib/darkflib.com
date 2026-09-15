import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { type Project, projects } from '../content'
import { PanelHeader } from './PanelHeader'
import { ResponsiveImage } from './ResponsiveImage'
import { TagList } from './TagList'
import './ProjectsPanel.css'

export function ProjectsPanel({ onSelect }: { onSelect: (project: Project) => void }) {
  return (
    <section className="panel projects-panel" id="projects" aria-labelledby="projects-title">
      <PanelHeader id="projects-title" title="FEATURED_PROJECTS">
        <span className="panel-link">
          SELECTED CONCEPTS <ArrowRight size={14} />
        </span>
      </PanelHeader>
      <div className="project-grid">
        {projects.map((project) => (
          <button
            type="button"
            className="project-card"
            key={project.number}
            onClick={() => onSelect(project)}
            aria-label={`Explore ${project.name}`}
          >
            <span className="project-image">
              <ResponsiveImage
                base={`projects/${project.image}`}
                widths={[400, 682]}
                sizes="(max-width: 560px) 40vw, (max-width: 800px) 31vw, 18vw"
                width={682}
                height={768}
              />
              <span className="project-number">{project.number}</span>
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
        ))}
      </div>
    </section>
  )
}
