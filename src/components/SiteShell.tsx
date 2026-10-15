import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { ContactDialog } from './ContactDialog'
import { Footer } from './Footer'
import { Topbar } from './Topbar'

// Links to the CONNECT panel, from this page or another one.
const CONTACT_LINKS = 'a[href="#contact"], a[href="/#contact"]'

interface SiteShellProps {
  /** Which top-level page this is, for the nav's active link. */
  page: 'home' | 'demos'
  children: ReactNode
  /** Overlays that sit outside <main>, such as page-specific dialogs. */
  overlays?: ReactNode
}

const OpenContact = createContext<() => void>(() => {})

/** Opens the shared contact dialog, for controls that are buttons rather than links to #contact. */
export const useOpenContact = () => useContext(OpenContact)

/** The chrome every page shares: grain, top bar, footer, and the contact dialog that CONTACT links open. */
export function SiteShell({ page, children, overlays }: SiteShellProps) {
  const [contactOpen, setContactOpen] = useState(false)

  useEffect(() => {
    // Every link to #contact opens the dialog instead of scrolling to (or navigating to) the CONNECT panel.
    const openOnLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest(CONTACT_LINKS)) {
        event.preventDefault()
        setContactOpen(true)
      }
    }
    document.addEventListener('click', openOnLink)
    return () => document.removeEventListener('click', openOnLink)
  }, [])

  return (
    <OpenContact.Provider value={() => setContactOpen(true)}>
      <div className="site-shell" id="home">
        <div className="site-grain" aria-hidden="true" />
        <Topbar page={page} />
        <main>{children}</main>
        <Footer />
        {overlays}
        <ContactDialog open={contactOpen} onClose={() => setContactOpen(false)} />
      </div>
    </OpenContact.Provider>
  )
}
