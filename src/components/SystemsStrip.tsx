import { useClock } from '../hooks/useClock'
import './SystemsStrip.css'

const SIGNAL_BARS = Array.from({ length: 62 }, (_, index) => ({ id: index, height: 4 + ((index * 17) % 15) }))

export function SystemsStrip() {
  const clock = useClock()

  return (
    <section className="systems-strip" aria-label="Live site information">
      <div>
        <span className="live-dot" /> SYSTEMS ONLINE
      </div>
      <div>CREATIVE MODE: ENABLED</div>
      <div>LOCATION: WORLDWIDE</div>
      <div>UTC: {clock}</div>
      <div className="signal-bars" aria-hidden="true">
        {SIGNAL_BARS.map((bar) => (
          <i key={bar.id} style={{ height: `${bar.height}px` }} />
        ))}
      </div>
      <div>IDEAS &gt; CODE &gt; IMPACT</div>
    </section>
  )
}
