import { ArrowUpRight, Mail } from 'lucide-react'
import { PanelHeader } from './PanelHeader'
import { useOpenContact } from './SiteShell'
import './ConnectPanel.css'

export function ConnectPanel() {
  const onOpenContact = useOpenContact()
  return (
    <section className="panel connect-panel" id="contact" aria-labelledby="contact-title">
      <PanelHeader id="contact-title" title="CONNECT">
        <ArrowUpRight size={18} strokeWidth={1.4} />
      </PanelHeader>
      <div className="connect-body">
        <p>
          GOT SOMETHING
          <br />
          WORTH BREAKING?
        </p>
        <button type="button" className="contact-button" onClick={onOpenContact}>
          <Mail size={18} /> OPEN CHANNEL
        </button>
      </div>
    </section>
  )
}
