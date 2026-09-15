import type { ReactNode } from 'react'

interface PanelHeaderProps {
  id?: string
  title: string
  meta?: ReactNode
  children?: ReactNode
}

export function PanelHeader({ id, title, meta, children }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <h2 id={id}>
        <span>{'//'}</span> {title}
        {meta && <> {meta}</>}
      </h2>
      {children}
    </div>
  )
}
