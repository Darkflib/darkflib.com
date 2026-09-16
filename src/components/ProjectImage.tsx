import type { Project } from '../content'
import { ResponsiveImage } from './ResponsiveImage'

/** The project's screenshot, or a terminal-style stand-in for a project with nothing public to show. */
export function ProjectImage({ project, sizes }: { project: Project; sizes: string }) {
  if (project.image) {
    return (
      <ResponsiveImage base={`projects/${project.image}`} widths={[400, 800]} sizes={sizes} width={1200} height={900} />
    )
  }
  return (
    <span className="project-glyph" aria-hidden="true">
      <span>
        <b>$</b> {project.slug}
      </span>
      <span>status: private</span>
      <span>
        source: <i>not public</i>
      </span>
      <span className="cursor">_</span>
    </span>
  )
}
