import { useEffect, useState } from 'react'

/**
 * Frames per second the browser actually rendered, counted with requestAnimationFrame and reported once a second; null
 * until the first second has passed. Counting restarts when the tab becomes visible, since hidden tabs render nothing.
 */
export function useFrameRate(): number | null {
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    let frames = 0
    let since = performance.now()
    let request = 0
    const frame = (now: number) => {
      frames += 1
      const elapsed = now - since
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed))
        frames = 0
        since = now
      }
      request = window.requestAnimationFrame(frame)
    }
    const restart = () => {
      if (document.visibilityState !== 'visible') return
      frames = 0
      since = performance.now()
    }
    request = window.requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', restart)
    return () => {
      window.cancelAnimationFrame(request)
      document.removeEventListener('visibilitychange', restart)
    }
  }, [])
  return fps
}
