import { useSyncExternalStore } from 'react'

type Level = 'info' | 'warn' | 'error'
type Source = 'page' | 'service-worker'

export interface LogEntry {
  id: number
  timestamp: string
  source: Source
  level: Level
  event: string
  detail?: string
}

export interface WorkerSnapshot {
  registration: 'checking' | 'registered' | 'unsupported' | 'failed'
  lifecycle: ServiceWorkerState | 'unknown'
  controlled: boolean
  scope: string
  script: string
  entries: readonly LogEntry[]
}

let state: WorkerSnapshot = {
  registration: 'checking',
  lifecycle: 'unknown',
  controlled: false,
  scope: '—',
  script: '/service-worker.js',
  entries: [],
}
let nextId = 0
let started = false
const listeners = new Set<() => void>()
const observed = new WeakSet<ServiceWorker>()

function publish(patch: Partial<WorkerSnapshot>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function log(source: Source, level: Level, event: string, detail?: string) {
  const entry: LogEntry = { id: ++nextId, timestamp: new Date().toISOString(), source, level, event, detail }
  publish({ entries: [...state.entries.slice(-199), entry] })
}

function observe(worker: ServiceWorker | null, label: string) {
  if (!worker || observed.has(worker)) return
  observed.add(worker)
  publish({ lifecycle: worker.state, script: new URL(worker.scriptURL).pathname })
  log('page', 'info', `worker:${label}`, worker.state)
  worker.addEventListener('statechange', () => {
    publish({ lifecycle: worker.state })
    log('page', 'info', 'statechange', worker.state)
  })
}

function syncController() {
  const controller = navigator.serviceWorker.controller
  publish({ controlled: controller !== null })
  log('page', 'info', 'controller', controller ? 'page controlled' : 'page not yet controlled')
}

export function startServiceWorker() {
  if (started) return
  started = true

  if (!('serviceWorker' in navigator)) {
    publish({ registration: 'unsupported' })
    log('page', 'warn', 'unsupported', 'Service workers are unavailable in this browser.')
    return
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    log('page', 'info', 'controllerchange')
    syncController()
  })

  navigator.serviceWorker.addEventListener('message', (messageEvent: MessageEvent) => {
    const message: unknown = messageEvent.data
    if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'sw:log' || !('entry' in message)) return
    const entry = message.entry
    if (typeof entry !== 'object' || entry === null || !('event' in entry) || typeof entry.event !== 'string') return
    const detail = 'detail' in entry && typeof entry.detail === 'string' ? entry.detail : undefined
    log('service-worker', 'info', entry.event, detail)
  })

  void (async () => {
    try {
      log('page', 'info', 'register:start')
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      publish({ registration: 'registered', scope: new URL(registration.scope).pathname })
      log('page', 'info', 'register:complete', registration.scope)
      observe(registration.installing, 'installing')
      observe(registration.waiting, 'waiting')
      observe(registration.active, 'active')
      registration.addEventListener('updatefound', () => {
        log('page', 'info', 'updatefound')
        observe(registration.installing, 'installing')
      })
      syncController()
      const ready = await navigator.serviceWorker.ready
      observe(ready.active, 'ready')
      log('page', 'info', 'ready', ready.active?.state ?? 'no active worker')
      syncController()
    } catch (error) {
      publish({ registration: 'failed' })
      log('page', 'error', 'register:failed', error instanceof Error ? error.message : String(error))
    }
  })()
}

export function clearServiceWorkerLog() {
  publish({ entries: [] })
}

export function useServiceWorker(): WorkerSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
