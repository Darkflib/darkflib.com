import './Footer.css'

export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} DARKFLIB. ALL RIGHTS RESERVED.</span>
      <span className="footer-center">MADE ON A MORE INTERESTING INTERNET.</span>
      <a href="#home">BACK TO TOP ↑</a>
    </footer>
  )
}
