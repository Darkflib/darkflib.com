import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { PanelHeader } from './PanelHeader'

export function ConnectPanel() {
  const [contactOpen, setContactOpen] = useState(false)

  return (
    <section className="panel connect-panel" id="contact" aria-labelledby="contact-title">
      <PanelHeader id="contact-title" title="CONNECT">
        <ArrowUpRight size={18} strokeWidth={1.4} />
      </PanelHeader>
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
          type="button"
          className="contact-button"
          aria-label="Show contact status"
          onClick={() => setContactOpen((open) => !open)}
        >
          <span>✉</span>
          <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  )
}
