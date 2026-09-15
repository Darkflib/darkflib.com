import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

const DIST = new URL('../../dist/', import.meta.url).pathname
const SERVICE_WORKER = 'service-worker.js'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
}

// The build id the plugin bakes into the worker: "<sha>[-dirty]+<8 hex>". Coupled to build/serviceWorkerPlugin.ts.
const VERSION_LITERAL = /"([\w-]+\+[0-9a-f]{8})"/

export interface TestServer {
  url: string
  /** Serve a byte-different worker reporting `<build>.test<n>`, so the next update check finds a new version. */
  bumpServiceWorker(): void
  /** Emulate host nginx's `Server-Timing: edge;desc=...` header (on by default). */
  setEdgeTiming(enabled: boolean): void
  /** Serve this source as /service-worker.js instead of the build's worker, e.g. one from an older deploy. */
  setServiceWorkerOverride(source: string | null): void
  reset(): void
  close(): Promise<void>
}

/** Static server for dist/ with a controllable service worker script. One per Playwright worker, on its own port. */
export async function startServer(): Promise<TestServer> {
  let bump = 0
  let edgeTiming = true
  let workerOverride: string | null = null

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const file = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^\/+/, '')
    try {
      let body: Buffer | string =
        file === SERVICE_WORKER && workerOverride !== null ? workerOverride : await readFile(join(DIST, file))
      if (file === SERVICE_WORKER && workerOverride === null && bump > 0) {
        const code = body.toString('utf8')
        if (!VERSION_LITERAL.test(code)) throw new Error('service worker version literal not found')
        body = code.replace(VERSION_LITERAL, (_match, version: string) => `"${version}.test${bump}"`)
      }
      const revalidate = file === SERVICE_WORKER || file === 'index.html'
      const headers: Record<string, string> = {
        'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=3600',
      }
      // As deploy/nginx/darkflib.conf reports it: cacheable responses are edge hits, the rest pass through.
      if (edgeTiming) headers['Server-Timing'] = `edge;desc=${revalidate ? 'MISS' : 'HIT'}`
      res.writeHead(200, headers)
      res.end(body)
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      res.writeHead(missing ? 404 : 500).end(missing ? 'not found' : String(error))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    bumpServiceWorker: () => {
      bump += 1
    },
    setEdgeTiming: (enabled) => {
      edgeTiming = enabled
    },
    setServiceWorkerOverride: (source) => {
      workerOverride = source
    },
    reset: () => {
      bump = 0
      edgeTiming = true
      workerOverride = null
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
