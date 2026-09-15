import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, Globe2, Menu, Radio, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearServiceWorkerLog, startServiceWorker, useServiceWorker } from './serviceWorker'

const projects = [
  {
    number: '01',
    name: 'NEON DISTRICT',
    description: 'A visual storytelling experience',
    tags: ['WEB', 'CREATIVE', 'EXPERIMENTAL'],
    position: 'left',
  },
  {
    number: '02',
    name: 'ECHO',
    description: 'AI-powered creative tools',
    tags: ['AI', 'PRODUCT', 'WEB'],
    position: 'center',
  },
  {
    number: '03',
    name: 'HORIZON',
    description: 'A minimal theme for modern creators',
    tags: ['WEB', 'UI/UX', 'OPEN SOURCE'],
    position: 'right',
  },
] as const

const stack = [
  { mark: '⚛', name: 'React', color: 'cyan' },
  { mark: 'N', name: 'Next.js', color: 'white' },
  { mark: 'TS', name: 'TypeScript', color: 'blue' },
  { mark: 'JS', name: 'Node.js', color: 'green' },
  { mark: '≈', name: 'Tailwind', color: 'cyan' },
  { mark: '●', name: 'Figma', color: 'pink' },
  { mark: 'Py', name: 'Python', color: 'yellow' },
  { mark: 'Pg', name: 'PostgreSQL', color: 'blue' },
] as const

function useClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const interval = window.setInterval(() => setTime(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  return time.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' })
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<(typeof projects)[number] | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const worker = useServiceWorker()
  const clock = useClock()

  useEffect(() => startServiceWorker(), [])
  useEffect(() => {
    if (!selectedProject) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedProject(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selectedProject])

  const nav = [
    ['HOME', '#home'],
    ['ABOUT', '#about'],
    ['PROJECTS', '#projects'],
    ['SKILLS', '#skills'],
    ['CONTACT', '#contact'],
  ]

  return (
    <div className="site-shell min-h-screen" id="home">
      <div className="site-grain" aria-hidden="true" />
      <header className="topbar">
        <a className="brand flex items-center" href="#home" aria-label="Darkflib home">
          <Globe2 size={25} strokeWidth={1.35} />
          <strong>DARKFLIB.EXE</strong>
          <span className="brand-slashes">/////</span>
          <small>// PERSONAL_INTERFACE V2.0</small>
        </a>
        <nav className={menuOpen ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
          {nav.map(([label, href]) => (
            <a key={label} href={href} className={label === 'HOME' ? 'active' : ''} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
        <button
          className="menu-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-art" aria-hidden="true" />
          <div className="hero-shade" aria-hidden="true" />
          <aside className="hero-rail" aria-label="Site motto and shortcuts">
            <div className="rail-quote">
              SOME
              <br />
              PEOPLE
              <br />
              SEE CHAOS.
              <br />
              <br />I SEE
              <br />
              POSSIBILITIES.
              <span className="cursor-line" />
            </div>
            <div className="rail-links">
              <a href="#projects" className="selected">
                <ChevronRight size={13} /> EXPLORE
              </a>
              <a href="#skills">
                <ChevronRight size={13} /> BUILD
              </a>
              <a href="#systems">
                <ChevronRight size={13} /> BREAK
              </a>
              <a href="#contact">
                <ChevronRight size={13} /> REPEAT
              </a>
            </div>
            <p>
              BETTER
              <br />
              SOFTWARE.
              <br />
              BRIGHTER
              <br />
              TOMORROW.
            </p>
          </aside>
          <div className="hero-copy" id="about">
            <div className="hero-intro">
              // HELLO_WORLD();
              <br />
              // WELCOME TO MY SPACE
            </div>
            <h1 id="hero-title">
              DARKFLIB
              <span className="title-glitch" aria-hidden="true">
                _
              </span>
            </h1>
            <div className="kana">ダークフリブ</div>
            <div className="hero-role">
              CREATIVE DEVELOPER <span>/</span> DIGITAL EXPLORER <span>/</span> BUILDING A BRIGHTER TOMORROW
            </div>
            <p className="hero-description">
              I design and build digital experiences
              <br className="desktop-break" /> at the intersection of code, art and imagination.
              <br className="desktop-break" /> Exploring the web, technology and creative systems
              <br className="desktop-break" /> to turn ideas into something real.
            </p>
            <div className="hero-actions flex flex-wrap">
              <a href="#projects" className="button-primary">
                VIEW MY WORK <ArrowRight size={18} />
              </a>
              <a href="#systems" className="button-secondary">
                EXPLORE SYSTEMS
              </a>
            </div>
          </div>
          <div className="hero-right-top">
            TOKYO
            <br />
            SEOUL
            <br />
            LONDON
            <br />
            SOMEWHERE
            <br />
            ONLINE
            <br />
            // ALWAYS
          </div>
          <div className="hero-right-bottom">
            GOOD
            <br />
            IDEAS
            <br />
            TRAVEL
            <br />
            FURTHER <span>—</span>
          </div>
          <div className="hero-signature" aria-hidden="true">
            Some
            <br />
            Human
            <br />
            Different
            <br />
            Network
          </div>
          <div className="hero-bottom-caption">
            v2.0
            <br />
            STILL EXPLORING
            <br />
            STILL BUILDING
            <br />
            STILL ME
          </div>
        </section>

        <div className="systems-strip" aria-label="Live site information">
          <div>
            <span className="live-dot" /> SYSTEMS ONLINE
          </div>
          <div>CREATIVE MODE: ENABLED</div>
          <div>LOCATION: WORLDWIDE</div>
          <div>UTC: {clock}</div>
          <div className="signal-bars" aria-hidden="true">
            {Array.from({ length: 62 }, (_, index) => (
              <i key={index} style={{ height: `${4 + ((index * 17) % 15)}px` }} />
            ))}
          </div>
          <div>IDEAS &gt; CODE &gt; IMPACT</div>
        </div>

        <div className="dashboard-grid grid">
          <section className="panel projects-panel" id="projects" aria-labelledby="projects-title">
            <div className="panel-header">
              <h2 id="projects-title">
                <span>//</span> FEATURED_PROJECTS
              </h2>
              <span className="panel-link">
                SELECTED CONCEPTS <ArrowRight size={14} />
              </span>
            </div>
            <div className="project-grid grid">
              {projects.map((project) => (
                <button
                  className="project-card"
                  key={project.number}
                  onClick={() => setSelectedProject(project)}
                  aria-label={`Explore ${project.name}`}
                >
                  <span className={`project-image ${project.position}`}>
                    <span className="project-number">{project.number}</span>
                  </span>
                  <span className="project-content">
                    <span className="project-heading">
                      {project.name}
                      <ArrowUpRight size={23} strokeWidth={1.4} />
                    </span>
                    <span className="project-description">{project.description}</span>
                    <span className="project-tags">
                      {project.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel stack-panel" id="skills" aria-labelledby="stack-title">
            <div className="panel-header">
              <h2 id="stack-title">
                <span>//</span> TECH_STACK
              </h2>
            </div>
            <div className="stack-grid">
              {stack.map((item) => (
                <div className="stack-item" key={item.name}>
                  <span className={`stack-mark ${item.color}`}>{item.mark}</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
            <div className="stack-quote">
              <span>“</span>
              <p>
                GOOD TOOLS
                <br />
                BETTER IDEAS
              </p>
              <span className="quote-rule">—</span>
            </div>
          </section>

          <div className="side-column">
            <section className="panel connect-panel" id="contact" aria-labelledby="contact-title">
              <div className="panel-header">
                <h2 id="contact-title">
                  <span>//</span> CONNECT
                </h2>
                <ArrowUpRight size={18} strokeWidth={1.4} />
              </div>
              <div className="connect-body">
                <p>
                  {contactOpen ? (
                    <>
                      CONTACT CHANNEL
                      <br />
                      COMING ONLINE.
                    </>
                  ) : (
                    <>
                      LET'S BUILD
                      <br />
                      SOMETHING COOL.
                    </>
                  )}
                </p>
                <button
                  className="contact-button"
                  aria-label="Show contact status"
                  onClick={() => setContactOpen((open) => !open)}
                >
                  <span>✉</span>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </section>
            <section className="panel status-panel" id="systems" aria-labelledby="status-title">
              <div className="panel-header">
                <h2 id="status-title">
                  <span>//</span> SERVICE_WORKER
                </h2>
              </div>
              <div className="status-row">
                <span className={`status-dot ${worker.controlled ? 'on' : ''}`} />
                {worker.controlled
                  ? 'CONTROLLING THIS PAGE'
                  : worker.registration === 'failed'
                    ? 'REGISTRATION FAILED'
                    : worker.registration === 'unsupported'
                      ? 'NOT SUPPORTED'
                      : 'INITIALISING'}
              </div>
              <dl className="worker-details">
                <div>
                  <dt>REGISTRATION</dt>
                  <dd>{worker.registration.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>LIFECYCLE</dt>
                  <dd>{worker.lifecycle.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>PAGE CONTROL</dt>
                  <dd>{worker.controlled ? 'CONTROLLED' : 'NOT YET'}</dd>
                </div>
                <div>
                  <dt>SCOPE</dt>
                  <dd>{worker.scope}</dd>
                </div>
              </dl>
              <button className="log-toggle" onClick={() => setLogOpen((open) => !open)} aria-expanded={logOpen}>
                {logOpen ? 'HIDE EVENT LOG' : 'VIEW EVENT LOG'} <ArrowDownRight size={15} />
              </button>
            </section>
          </div>
        </div>

        {logOpen && (
          <section className="event-panel panel" aria-label="Service worker event log">
            <div className="panel-header">
              <h2>
                <span>//</span> EVENT_LOG <small>{worker.entries.length} / 200</small>
              </h2>
              <button onClick={clearServiceWorkerLog}>CLEAR LOG</button>
            </div>
            <ol>
              {worker.entries.length === 0 ? (
                <li className="empty-log">No events yet.</li>
              ) : (
                [...worker.entries].reverse().map((entry) => (
                  <li key={entry.id}>
                    <time>
                      {new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false })}.
                      {entry.timestamp.slice(20, 23)}
                    </time>
                    <span className={entry.source === 'service-worker' ? 'sw-source' : ''}>
                      {entry.source === 'service-worker' ? 'WORKER' : 'PAGE'}
                    </span>
                    <strong>{entry.event}</strong>
                    <em>{entry.detail}</em>
                  </li>
                ))
              )}
            </ol>
            <p className="log-note">
              <Radio size={14} /> Lifecycle telemetry only. No request interception or fault injection is active.
            </p>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} DARKFLIB. ALL RIGHTS RESERVED.</span>
        <span className="footer-center">MADE ON A MORE INTERESTING INTERNET.</span>
        <a href="#home">BACK TO TOP ↑</a>
      </footer>

      {selectedProject && (
        <div
          className="modal-backdrop fixed inset-0 flex items-center justify-center"
          onClick={() => setSelectedProject(null)}
        >
          <div
            className="project-modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSelectedProject(null)} aria-label="Close project details">
              <X size={20} />
            </button>
            <div className={`modal-image project-image ${selectedProject.position}`} />
            <div className="modal-copy">
              <span>CONCEPT / {selectedProject.number}</span>
              <h2 id="project-modal-title">{selectedProject.name}</h2>
              <p>
                {selectedProject.description}. This visual concept is part of the Darkflib interface study; project
                details and live links will be added as the site takes shape.
              </p>
              <div className="project-tags">
                {selectedProject.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <button className="button-secondary" onClick={() => setSelectedProject(null)}>
                RETURN TO PROJECTS <Check size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
