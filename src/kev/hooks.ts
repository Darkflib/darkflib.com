import { useEffect, useState } from 'react'
import { fetchSnapshot, type KevSnapshot } from './snapshot'

/**
 * The KEV snapshot, once. It is a static file that changes hourly, and the page is not a dashboard someone leaves
 * open for a day; a reload is the refresh. A failed or absent snapshot stays null, and the panel renders nothing.
 */
export function useKevSnapshot(): KevSnapshot | null {
  const [snapshot, setSnapshot] = useState<KevSnapshot | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // Rejections (including the abort under StrictMode's double effect) leave the panel hidden.
    fetchSnapshot(controller.signal)
      .then(setSnapshot)
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return snapshot
}
