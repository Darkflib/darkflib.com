import { Globe2, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { nav, type SitePage } from '../content'
import './Topbar.css'

export function Topbar({ page }: { page: SitePage }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Darkflib home">
        <Globe2 size={25} strokeWidth={1.35} />
        <strong>DARKFLIB.COM</strong>
        <span className="brand-slashes">{'/////'}</span>
        <small>{'// PERSONAL_INTERFACE V2.0'}</small>
      </a>
      <nav className={menuOpen ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
        {nav.map((item) => {
          const current = 'page' in item && item.page === page
          return (
            <a
              key={item.label}
              href={item.href}
              className={current ? 'active' : ''}
              aria-current={current ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </a>
          )
        })}
      </nav>
      <button
        type="button"
        className="menu-toggle"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X /> : <Menu />}
      </button>
    </header>
  )
}
