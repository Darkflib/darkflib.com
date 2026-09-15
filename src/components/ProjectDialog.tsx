import { Check, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Project } from '../content'
import { ResponsiveImage } from './ResponsiveImage'
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
            <ResponsiveImage
              base={`projects/${project.image}`}
              widths={[400, 682]}
              sizes="(max-width: 560px) 100vw, 351px"
              width={682}
              height={768}
            />
          </div>
          <div className="modal-copy">
            <span>CONCEPT / {project.number}</span>
            <h2 id="project-dialog-title">{project.name}</h2>
            <p>
              {project.description}. This visual concept is part of the Darkflib interface study; project details and
              live links will be added as the site takes shape.
            </p>
            <TagList tags={project.tags} />
            <button type="button" className="button-secondary" onClick={close}>
              RETURN TO PROJECTS <Check size={16} />
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
