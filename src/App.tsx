import { useEffect, useState } from 'react'
import { ConnectPanel } from './components/ConnectPanel'
import { ContactDialog } from './components/ContactDialog'
import { ControlsPanel } from './components/ControlsPanel'
import { EventLog } from './components/EventLog'
import { FaultLab } from './components/FaultLab'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { PostsPanel } from './components/PostsPanel'
import { ProjectDialog } from './components/ProjectDialog'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ServiceWorkerPanel } from './components/ServiceWorkerPanel'
import { StackPanel } from './components/StackPanel'
import { SystemsStrip } from './components/SystemsStrip'
import { ToolsPanel } from './components/ToolsPanel'
import { Topbar } from './components/Topbar'
import type { Project } from './content'
import './App.css'

const LAB_HASH = '#fault-lab'
const CONTACT_HASH = '#contact'

export function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  // Collapsed by default; a link to #fault-lab (the hero's BREAK, or a shared URL) opens it.
  const [labOpen, setLabOpen] = useState(() => window.location.hash === LAB_HASH)

  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash === LAB_HASH) setLabOpen(true)
    }
    // hashchange does not fire when the hash is already #fault-lab, so catch the link clicks too.
    const openOnLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest(`a[href="${LAB_HASH}"]`)) setLabOpen(true)
      // Every link to #contact opens the dialog instead of scrolling to the CONNECT panel.
      if (event.target.closest(`a[href="${CONTACT_HASH}"]`)) {
        event.preventDefault()
        setContactOpen(true)
      }
    }
    window.addEventListener('hashchange', openOnHash)
    document.addEventListener('click', openOnLink)
    return () => {
      window.removeEventListener('hashchange', openOnHash)
      document.removeEventListener('click', openOnLink)
    }
  }, [])

  const toggleLab = () => setLabOpen((open) => !open)
  const toggleLog = () => setLogOpen((open) => !open)

  return (
    <div className="site-shell" id="home">
      <div className="site-grain" aria-hidden="true" />
      <Topbar />
      <main>
        <Hero />
        <SystemsStrip />
        <div className="dashboard-grid">
          <ProjectsPanel onSelect={setSelectedProject} />
          <div className="middle-column">
            <StackPanel />
            <ConnectPanel onOpenContact={() => setContactOpen(true)} />
          </div>
          <div className="side-column">
            <ServiceWorkerPanel />
            <ControlsPanel labOpen={labOpen} onToggleLab={toggleLab} logOpen={logOpen} onToggleLog={toggleLog} />
          </div>
        </div>
        <div className="writing-grid">
          <PostsPanel />
          <ToolsPanel />
        </div>
        <FaultLab open={labOpen} onToggle={toggleLab} />
        {logOpen && <EventLog />}
      </main>
      <Footer />
      <ProjectDialog project={selectedProject} onClose={() => setSelectedProject(null)} />
      <ContactDialog open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  )
}
