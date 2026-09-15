// v0 worker: lifecycle telemetry and a version handshake. No fetch listener, so it never intercepts requests.
import { isClientMessage, type LogLevel, type WorkerMessage } from './protocol'

declare const self: ServiceWorkerGlobalScope
declare const __SW_VERSION__: string

const VERSION = __SW_VERSION__

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

self.addEventListener('message', (event) => {
  if (!isClientMessage(event.data)) return
  const [port] = event.ports
  if (!port) return
  const reply: WorkerMessage = { type: 'sw:hello:reply', version: VERSION }
  port.postMessage(reply)
})
