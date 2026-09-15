import { Globe2, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { nav } from '../content'
import './Topbar.css'

export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="topbar">
      <a className="brand" href="#home" aria-label="Darkflib home">
        <Globe2 size={25} strokeWidth={1.35} />
        <strong>DARKFLIB.COM</strong>
        <span className="brand-slashes">{'/////'}</span>
        <small>{'// PERSONAL_INTERFACE V2.0'}</small>
      </a>
      <nav className={menuOpen ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
        {nav.map(({ label, href }) => (
          <a key={label} href={href} className={label === 'HOME' ? 'active' : ''} onClick={() => setMenuOpen(false)}>
            {label}
          </a>
        ))}
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
