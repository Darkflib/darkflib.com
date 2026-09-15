// Lifecycle telemetry, a version handshake, and a passive fetch observer. The fetch listener never calls respondWith,
// so every request is performed by the browser exactly as it would be without this worker.
import { isClientMessage, type LogLevel, MAX_REQUEST_BATCH, type ObservedRequest, type WorkerMessage } from './protocol'

declare const self: ServiceWorkerGlobalScope
declare const __SW_VERSION__: string

const VERSION = __SW_VERSION__

/** Batch observed requests briefly so a page load becomes a few messages rather than one per request. */
const FLUSH_DELAY_MS = 50
/** Bounds on what waits for a tab that does not exist yet (or never will: a cancelled navigation). */
const MAX_PENDING_PER_CLIENT = MAX_REQUEST_BATCH
const MAX_PENDING_CLIENTS = 32

async function broadcast(level: LogLevel, event: string, detail?: string): Promise<void> {
  const time = Date.now()
  // Include uncontrolled clients: on first install no page is controlled yet.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const message: WorkerMessage = { type: 'sw:log', entry: { time, level, event, detail } }
  for (const client of clients) client.postMessage(message)
}

self.addEventListener('install', (event) => {
  // No skipWaiting(): an updated worker waits until no page is using the old one.
  event.waitUntil(broadcast('info', 'install', `build ${VERSION}`))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await broadcast('info', 'activate:start', `build ${VERSION}`)
      // Take control of pages opened before this worker existed, so the first visit is observable without a reload.
      await self.clients.claim()
      await broadcast('info', 'activate:complete', `build ${VERSION}`)
    })(),
  )
})

// --- Passive fetch observer ------------------------------------------------------------------------------------------

// Observed requests waiting for delivery, per tab (Map order is insertion order, oldest first). A navigation's
// resulting tab does not exist when its fetch event fires, so its entry waits until clients.get() can find it: the next
// flush, which that page's own subresource requests trigger, or its hello.
const pending = new Map<string, ObservedRequest[]>()
let flushScheduled: Promise<void> | null = null

function enqueue(clientId: string, request: ObservedRequest) {
  const queue = pending.get(clientId) ?? []
  queue.push(request)
  if (queue.length > MAX_PENDING_PER_CLIENT) queue.splice(0, queue.length - MAX_PENDING_PER_CLIENT)
  pending.delete(clientId)
  pending.set(clientId, queue)
  while (pending.size > MAX_PENDING_CLIENTS) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) break
    pending.delete(oldest)
  }
}

async function deliver(clientId: string): Promise<void> {
  const requests = pending.get(clientId)
  if (!requests?.length) return
  const client = await self.clients.get(clientId)
  if (!client) return
  // Re-read after the await: requests may have been appended, or already delivered by a concurrent flush.
  const batch = pending.get(clientId)
  pending.delete(clientId)
  if (!batch?.length) return
  const message: WorkerMessage = { type: 'sw:requests', requests: batch }
  client.postMessage(message)
}

function scheduleFlush(): Promise<void> {
  flushScheduled ??= new Promise<void>((resolve) => setTimeout(resolve, FLUSH_DELAY_MS)).then(async () => {
    // Cleared before delivering, so requests observed during delivery schedule a fresh flush rather than wait.
    flushScheduled = null
    await Promise.all([...pending.keys()].map(deliver))
  })
  return flushScheduled
}

self.addEventListener('fetch', (event) => {
  // Subresources carry their tab's clientId; a navigation carries the id of the tab it is about to create.
  const clientId = event.resultingClientId || event.clientId
  if (!clientId) return
  const { request } = event
  enqueue(clientId, {
    time: Date.now(),
    method: request.method,
    url: request.url,
    destination: request.destination,
    mode: request.mode,
  })
  // waitUntil only keeps the worker alive until the batch is delivered. There is deliberately no respondWith.
  event.waitUntil(scheduleFlush())
})

self.addEventListener('message', (event) => {
  if (!isClientMessage(event.data)) return
  const [port] = event.ports
  if (port) {
    const reply: WorkerMessage = { type: 'sw:hello:reply', version: VERSION }
    port.postMessage(reply)
  }
  // A page's hello means it is listening: hand over anything that was waiting for it, such as its own navigation.
  const source = event.source
  if (source && 'id' in source) event.waitUntil(deliver(source.id))
})
