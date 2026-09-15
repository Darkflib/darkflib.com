import { ArrowRight, ChevronRight } from 'lucide-react'
import { ResponsiveImage } from './ResponsiveImage'
import './Hero.css'

// Rendered widths under object-fit: cover; below 800 px the hero is taller than 16:9, so the image is wider than the
// viewport. Keep in sync with the preload in index.html.
const HERO_IMAGE_SIZES = '(max-width: 560px) 1049px, (max-width: 800px) 1173px, 100vw'

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <ResponsiveImage
        className="hero-art"
        base="hero-city"
        widths={[800, 1280, 1672]}
        sizes={HERO_IMAGE_SIZES}
        width={1672}
        height={941}
        priority
      />
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
          <a href="#fault-lab">
            <ChevronRight size={13} /> BREAK
          </a>
          <a href="#contact">
            <ChevronRight size={13} /> REPEAT
          </a>
        </div>
        <p>
          FAILURE
          <br />
          IS JUST
          <br />
          DATA.
        </p>
      </aside>
      <div className="hero-copy" id="about">
        <div className="hero-intro">
          {'// HELLO_WORLD();'}
          <br />
          {'// WELCOME TO MY SPACE'}
        </div>
        <h1 id="hero-title">
          DARKFLIB
          <span className="title-glitch" aria-hidden="true">
            _
          </span>
        </h1>
        <div className="kana">ダークフリブ</div>
        <div className="hero-role">
          CREATIVE DEVELOPER <span>/</span> DIGITAL EXPLORER <span>/</span> BREAKING THINGS ON PURPOSE
        </div>
        <p className="hero-description">
          I design and build digital experiences
          <br className="desktop-break" /> at the intersection of code, art and imagination.
          <br className="desktop-break" /> Exploring the web, technology and creative systems
          <br className="desktop-break" /> to turn ideas into something real.
        </p>
        <div className="hero-actions">
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
        {'// ALWAYS'}
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
  )
}
