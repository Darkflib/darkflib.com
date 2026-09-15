import { useSyncExternalStore } from 'react'
import {
  type Capabilities,
  type ClientMessage,
  isWorkerMessage,
  type LogLevel,
  type ObservedRequest,
  WORKER_CAPABILITIES,
} from '../sw/protocol'

const SCRIPT_URL = '/service-worker.js'
export const LOG_CAPACITY = 200
const HELLO_TIMEOUT_MS = 3000

type Source = 'page' | 'service-worker'

/** What a log line is about, so the log can hide categories. */
export type LogTag = 'lifecycle' | 'control' | 'fetch' | 'fault' | 'client'
export const LOG_TAGS: readonly LogTag[] = ['lifecycle', 'control', 'fetch', 'fault', 'client']

export interface LogEntry {
  id: number
  /** ISO 8601, UTC. */
  timestamp: string
  source: Source
  tag: LogTag
  level: LogLevel
  event: string
  detail?: string
}

export type RegistrationStatus = 'pending' | 'registered' | 'unsupported' | 'failed' | 'disabled'

/** State of the worker in each registration slot. An update installs alongside the active worker, then waits. */
export interface WorkerSlots {
  installing: ServiceWorkerState | null
  waiting: ServiceWorkerState | null
  active: ServiceWorkerState | null
}

export interface ServiceWorkerSnapshot {
  registration: RegistrationStatus
  slots: WorkerSlots
  /** Whether `navigator.serviceWorker.controller` is set for this page. */
  controlled: boolean
  /** Build reported by the controlling worker, once the handshake completes. */
  controllerVersion: string | null
  /** Capabilities the controlling worker reported; `{}` for a worker that predates the capabilities handshake. */
  controllerCapabilities: Capabilities | null
  /** Capabilities this page build expects that its controller lacks (or has at an older version). */
  missingCapabilities: readonly string[]
  /** Worker script instance behind the latest request batch; null until one arrives (see WorkerMessage). */
  reportedWorkerInstance: string | null
  entries: readonly LogEntry[]
}

let state: ServiceWorkerSnapshot = {
  registration: 'pending',
  slots: { installing: null, waiting: null, active: null },
  controlled: false,
  controllerVersion: null,
  controllerCapabilities: null,
  missingCapabilities: [],
  reportedWorkerInstance: null,
  entries: [],
}

/** Whether the controlling worker supports `name` at `version` or later. */
export function supports(snapshot: ServiceWorkerSnapshot, name: string, version = 1): boolean {
  return (snapshot.controllerCapabilities?.[name] ?? 0) >= version
}

function missingFrom(capabilities: Capabilities): string[] {
  return Object.entries(WORKER_CAPABILITIES)
    .filter(([name, version]) => (capabilities[name] ?? 0) < version)
    .map(([name, version]) => `${name} v${version}`)
}

function describeCapabilities(capabilities: Capabilities): string {
  const entries = Object.entries(capabilities)
  return entries.length ? entries.map(([name, version]) => `${name} v${version}`).join(', ') : 'none'
}
let nextEntryId = 0
let nextWorkerId = 0
let started = false
const listeners = new Set<() => void>()
const workerIds = new WeakMap<ServiceWorker, number>()
const observed = new WeakSet<ServiceWorker>()

function publish(patch: Partial<ServiceWorkerSnapshot>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

type NewEntry = Omit<LogEntry, 'id' | 'timestamp'> & { time?: number }

function append(batch: readonly NewEntry[]) {
  const entries = [...state.entries]
  for (const { time = Date.now(), ...fields } of batch) {
    const entry: LogEntry = { id: ++nextEntryId, timestamp: new Date(time).toISOString(), ...fields }
    // Keep the buffer in emit order: worker messages can arrive after later page-side events.
    let index = entries.length
    while (index > 0 && entries[index - 1].timestamp > entry.timestamp) index -= 1
    entries.splice(index, 0, entry)
  }
  // Over capacity, drop the oldest request rows first: a busy page must not push lifecycle history out of the log.
  while (entries.length > LOG_CAPACITY) {
    const oldestFetch = entries.findIndex((entry) => entry.tag === 'fetch')
    entries.splice(oldestFetch === -1 ? 0 : oldestFetch, 1)
  }
  publish({ entries })
}

function log(tag: LogTag, source: Source, level: LogLevel, event: string, detail?: string, time?: number) {
  append([{ tag, source, level, event, detail, time }])
}

/** Add a page-side event to the shared timeline (the Fault Lab client's retries, circuit changes, and failovers). */
export function recordEvent(tag: LogTag, level: LogLevel, event: string, detail?: string) {
  log(tag, 'page', level, event, detail)
}

/** Current snapshot, for modules that react outside React. */
export function getServiceWorkerSnapshot(): ServiceWorkerSnapshot {
  return state
}

/** Subscribe outside React; returns an unsubscribe function. */
export function subscribeServiceWorker(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function describeRequest(request: ObservedRequest): string {
  const url = new URL(request.url)
  const where =
    url.origin === window.location.origin ? `${url.pathname}${url.search}` : `${url.host}${url.pathname}${url.search}`
  const kind = request.mode === 'navigate' ? 'navigate' : request.destination || 'fetch'
  return `${request.method} ${where} · ${kind}`
}

/** Stable per-object label, so concurrent workers during an update are distinguishable in the log. */
function label(worker: ServiceWorker): string {
  let id = workerIds.get(worker)
  if (id === undefined) {
    id = ++nextWorkerId
    workerIds.set(worker, id)
  }
  return `worker#${id}`
}

function syncSlots(registration: ServiceWorkerRegistration) {
  const slots: WorkerSlots = {
    installing: registration.installing?.state ?? null,
    waiting: registration.waiting?.state ?? null,
    active: registration.active?.state ?? null,
  }
  publish({ slots })
}

function observe(registration: ServiceWorkerRegistration) {
  for (const [slot, worker] of [
    ['installing', registration.installing],
    ['waiting', registration.waiting],
    ['active', registration.active],
  ] as const) {
    if (!worker || observed.has(worker)) continue
    observed.add(worker)
    log('lifecycle', 'page', 'info', 'worker:observed', `${label(worker)} ${slot} (${worker.state})`)
    worker.addEventListener('statechange', () => {
      log(
        'lifecycle',
        'page',
        worker.state === 'redundant' ? 'warn' : 'info',
        'worker:statechange',
        `${label(worker)} → ${worker.state}`,
      )
      syncSlots(registration)
    })
  }
  syncSlots(registration)
}

let handshakeFor: ServiceWorker | null = null

interface HelloReply {
  version: string
  capabilities: Capabilities
}

async function hello(controller: ServiceWorker): Promise<HelloReply> {
  const channel = new MessageChannel()
  try {
    return await new Promise<HelloReply>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error(`no reply within ${HELLO_TIMEOUT_MS} ms`)),
        HELLO_TIMEOUT_MS,
      )
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer)
        const message: unknown = event.data
        if (isWorkerMessage(message) && message.type === 'sw:hello:reply') {
          resolve({ version: message.version, capabilities: message.capabilities ?? {} })
        } else reject(new Error('malformed reply'))
      }
      const request: ClientMessage = { type: 'sw:hello' }
      controller.postMessage(request, [channel.port2])
    })
  } finally {
    channel.port1.close()
  }
}

function syncController() {
  const controller = navigator.serviceWorker.controller
  log(
    'control',
    'page',
    'info',
    'controller',
    controller ? `controlled by ${label(controller)}` : 'page not controlled',
  )
  if (controller && handshakeFor === controller) return

  publish({
    controlled: controller !== null,
    controllerVersion: null,
    controllerCapabilities: null,
    missingCapabilities: [],
  })
  if (!controller) return
  handshakeFor = controller
  hello(controller).then(
    ({ version, capabilities }) => {
      // Ignore replies from a worker that has since been replaced as controller.
      if (navigator.serviceWorker.controller !== controller) return
      const missing = missingFrom(capabilities)
      publish({ controllerVersion: version, controllerCapabilities: capabilities, missingCapabilities: missing })
      log(
        'control',
        'page',
        missing.length ? 'warn' : 'info',
        'handshake',
        `${label(controller)} build ${version}; capabilities ${describeCapabilities(capabilities)}${
          missing.length ? `; outdated, missing ${missing.join(', ')}` : ''
        }`,
      )
    },
    (error: unknown) => {
      if (handshakeFor === controller) handshakeFor = null
      log('control', 'page', 'warn', 'handshake:failed', error instanceof Error ? error.message : String(error))
    },
  )
}

async function disable() {
  publish({ registration: 'disabled' })
  const registrations = await navigator.serviceWorker.getRegistrations()
  const results = await Promise.all(registrations.map((registration) => registration.unregister()))
  log(
    'lifecycle',
    'page',
    'warn',
    'disabled',
    `?sw=off: unregistered ${results.filter(Boolean).length} of ${registrations.length}`,
  )
}

async function register() {
  try {
    log('lifecycle', 'page', 'info', 'register:start', SCRIPT_URL)
    // updateViaCache 'none': update checks always bypass the HTTP cache for the worker script.
    const registration = await navigator.serviceWorker.register(SCRIPT_URL, { scope: '/', updateViaCache: 'none' })
    publish({ registration: 'registered' })
    log('lifecycle', 'page', 'info', 'register:complete', `scope ${new URL(registration.scope).pathname}`)
    observe(registration)
    registration.addEventListener('updatefound', () => {
      log('lifecycle', 'page', 'info', 'updatefound')
      observe(registration)
    })
    syncController()
    const ready = await navigator.serviceWorker.ready
    log(
      'lifecycle',
      'page',
      'info',
      'ready',
      ready.active ? `${label(ready.active)} ${ready.active.state}` : 'no active worker',
    )
    observe(ready)
  } catch (error) {
    publish({ registration: 'failed' })
    log('lifecycle', 'page', 'error', 'register:failed', error instanceof Error ? error.message : String(error))
  }
}

export function startServiceWorker() {
  if (started) return
  started = true

  if (!('serviceWorker' in navigator)) {
    publish({ registration: 'unsupported' })
    log('lifecycle', 'page', 'warn', 'unsupported', 'Service workers are unavailable in this browser.')
    return
  }

  const container = navigator.serviceWorker
  container.addEventListener('controllerchange', () => {
    log('control', 'page', 'info', 'controllerchange')
    syncController()
  })
  container.addEventListener('message', (event: MessageEvent) => {
    const message: unknown = event.data
    if (!isWorkerMessage(message)) return
    if (message.type === 'sw:log') {
      const { time, level, event: name, detail } = message.entry
      log('lifecycle', 'service-worker', level, name, detail, time)
    } else if (message.type === 'sw:requests') {
      if (message.instance !== undefined && message.instance !== state.reportedWorkerInstance) {
        publish({ reportedWorkerInstance: message.instance })
      }
      append(
        message.requests.map((request) =>
          request.fault
            ? {
                tag: 'fault' as const,
                source: 'service-worker' as const,
                level: 'warn' as const,
                event: `fault:${request.fault.mode}`,
                detail: `${describeRequest(request).replace(/ · [^·]+$/, '')} · ${request.fault.detail}`,
                time: request.time,
              }
            : {
                tag: 'fetch' as const,
                source: 'service-worker' as const,
                level: 'info' as const,
                event: 'fetch',
                detail: describeRequest(request),
                time: request.time,
              },
        ),
      )
    }
  })
  // addEventListener alone does not start delivery before the document has loaded. Call this as early as possible
  // (main.tsx does, at module load): once the queue opens, a message with no listener yet is simply dropped.
  container.startMessages()

  if (new URLSearchParams(window.location.search).get('sw') === 'off') {
    void disable()
    return
  }

  // Register after load so installation does not compete with first-paint resources.
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => void register(), { once: true })
}

export function clearServiceWorkerLog() {
  publish({ entries: [] })
}

export function useServiceWorker(): ServiceWorkerSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
