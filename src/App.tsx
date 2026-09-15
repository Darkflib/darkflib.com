import { useEffect, useState } from 'react'
import { ConnectPanel } from './components/ConnectPanel'
import { EventLog } from './components/EventLog'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { ProjectDialog } from './components/ProjectDialog'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ServiceWorkerPanel } from './components/ServiceWorkerPanel'
import { StackPanel } from './components/StackPanel'
import { SystemsStrip } from './components/SystemsStrip'
import { Topbar } from './components/Topbar'
import type { Project } from './content'
import { startServiceWorker } from './serviceWorker'

export function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => startServiceWorker(), [])

  return (
    <div className="site-shell" id="home">
      <div className="site-grain" aria-hidden="true" />
      <Topbar />
      <main>
        <Hero />
        <SystemsStrip />
        <div className="dashboard-grid">
          <ProjectsPanel onSelect={setSelectedProject} />
          <StackPanel />
          <div className="side-column">
            <ConnectPanel />
            <ServiceWorkerPanel logOpen={logOpen} onToggleLog={() => setLogOpen((open) => !open)} />
          </div>
        </div>
        {logOpen && <EventLog />}
      </main>
      <Footer />
      <ProjectDialog project={selectedProject} onClose={() => setSelectedProject(null)} />
    </div>
  )
}
