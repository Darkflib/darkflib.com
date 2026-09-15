// The v0 worker observes lifecycle only. It does not intercept requests.
async function broadcast(event, detail) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'sw:log', entry: { level: 'info', event, detail } })
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(broadcast('install'))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await broadcast('activate:start')
    await self.clients.claim()
    await broadcast('activate:complete')
  })())
})
