import { useEffect, useState } from 'react'

/** The current time, updated as each wall-clock second begins. */
export function useClock(): Date {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    let timer: number
    const schedule = () => {
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    const tick = () => {
      setTime(new Date())
      schedule()
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])
  return time
}
