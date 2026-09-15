import { useEffect, useState } from 'react'

export function useClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const interval = window.setInterval(() => setTime(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  return time.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' })
}
