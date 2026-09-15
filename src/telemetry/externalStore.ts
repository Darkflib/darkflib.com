import { useSyncExternalStore } from 'react'

/** Minimal external store for browser-sourced telemetry. `start` runs once, on first subscription. */
export function createStore<T>(initial: T, start: (set: (next: T) => void) => void) {
  let value = initial
  let started = false
  const listeners = new Set<() => void>()

  const set = (next: T) => {
    value = next
    for (const listener of listeners) listener()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (!started) {
      started = true
      start(set)
    }
    return () => listeners.delete(listener)
  }

  return {
    get: () => value,
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}
