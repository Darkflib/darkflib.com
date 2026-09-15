import { ArrowRight } from 'lucide-react'
import { TOOLS_URL, tools } from '../content'
import { PanelHeader } from './PanelHeader'
import './ToolsPanel.css'

export function ToolsPanel() {
  return (
    <section className="panel tools-panel" id="tools" aria-labelledby="tools-title">
      <PanelHeader id="tools-title" title="TOOLS">
        <a className="panel-link" href={TOOLS_URL}>
          ALL TOOLS <ArrowRight size={14} />
        </a>
      </PanelHeader>
      <p className="tools-note">Single-purpose utilities that run entirely in your browser.</p>
      <ul className="tool-list">
        {tools.map((tool) => (
          <li key={tool.slug}>
            <a href={`${TOOLS_URL}/${tool.slug}`}>
              <span className="tool-name">
                <span aria-hidden="true">$</span> {tool.slug}
              </span>
              <span className="tool-blurb">{tool.blurb}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
