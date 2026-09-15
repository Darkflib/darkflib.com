import { ArrowUpRight, Check, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { type Project, projectNumber } from '../content'
import { ProjectImage } from './ProjectImage'
import { TagList } from './TagList'
import './ProjectDialog.css'

interface ProjectDialogProps {
  project: Project | null
  onClose: () => void
}

// Native <dialog> via showModal() supplies the backdrop, focus trap, inert page, Escape handling, and focus restore.
export function ProjectDialog({ project, onClose }: ProjectDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (project && !dialog.open) dialog.showModal()
    if (!project && dialog.open) dialog.close()
  }, [project])

  const close = () => ref.current?.close()

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape is the native keyboard equivalent
    <dialog
      ref={ref}
      className="project-dialog panel"
      aria-labelledby="project-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the ::backdrop are dispatched to the dialog element itself.
        if (event.target === event.currentTarget) close()
      }}
    >
      {project && (
        <>
          <button type="button" className="modal-close" onClick={close} aria-label="Close project details">
            <X size={20} />
          </button>
          <div className="modal-image project-image">
            <ProjectImage project={project} sizes="(max-width: 560px) 100vw, 351px" />
          </div>
          <div className="modal-copy">
            <span>PROJECT / {projectNumber(project)}</span>
            <h2 id="project-dialog-title">{project.name}</h2>
            <p>{project.summary}</p>
            <TagList tags={project.tags} />
            <div className="modal-links">
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
              {!project.links.live && !project.links.source && (
                <span className="modal-private">PRIVATE: NO PUBLIC BUILD OR SOURCE YET</span>
              )}
            </div>
            <button type="button" className="modal-return" onClick={close}>
              RETURN TO PROJECTS <Check size={14} />
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
