import { useState } from 'react'
import { ConnectPanel } from './components/ConnectPanel'
import { ControlsPanel } from './components/ControlsPanel'
import { Hero } from './components/Hero'
import { KevPanel } from './components/KevPanel'
import { PostsPanel } from './components/PostsPanel'
import { ProjectDialog } from './components/ProjectDialog'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ServiceWorkerPanel } from './components/ServiceWorkerPanel'
import { SiteShell } from './components/SiteShell'
import { StackPanel } from './components/StackPanel'
import { SystemsStrip } from './components/SystemsStrip'
import { ToolsPanel } from './components/ToolsPanel'
import { type Project, projects } from './content'
import './App.css'

// The KEV panel's source link opens sre-tab's own card rather than sending a visitor to a dashboard they cannot sign
// in to.
const SRE_TAB = projects.find((project) => project.slug === 'sre-tab') ?? null

export function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)

  return (
    <SiteShell
      page="home"
      overlays={<ProjectDialog project={selectedProject} onClose={() => setSelectedProject(null)} />}
    >
      <Hero />
      <SystemsStrip />
      <div className="dashboard-grid">
        <ProjectsPanel onSelect={setSelectedProject} />
        <div className="middle-column">
          <StackPanel />
          <ConnectPanel />
        </div>
        <div className="side-column">
          <ServiceWorkerPanel />
          <ControlsPanel />
        </div>
      </div>
      <div className="writing-grid">
        <PostsPanel />
        <ToolsPanel />
      </div>
      <KevPanel onOpenSource={() => setSelectedProject(SRE_TAB)} />
    </SiteShell>
  )
}
