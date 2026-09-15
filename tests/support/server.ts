import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

const DIST = new URL('../../dist/', import.meta.url).pathname
const LAB_ORIGINS = new URL('../../lab/origins/', import.meta.url).pathname
const LAB_CONFIG = new URL('../../public/lab/config.json', import.meta.url).pathname
const LAB_TARGETS = ['api-primary', 'api-secondary', 'media'] as const
export type LabTarget = (typeof LAB_TARGETS)[number]
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
  /** Local stand-ins for the Fault Lab origins, each on its own port; /lab/config.json points the page at these. */
  labOrigins: Record<LabTarget, string>
  /**
   * Requests that actually reached a lab origin since the last reset, optionally only those whose URL contains
   * `marker`: what a fault stopped shows up here. Use a marker per request when precision matters, since a latency
   * fault's delayed request from a previous test can still arrive.
   */
  labRequests(target: LabTarget, marker?: string): number
  /**
   * Whether the page's status client polls (off by default). It polls continuously, which would keep Playwright's
   * networkidle from ever settling and add requests to origin counts, so only tests of the lab itself switch it on.
   */
  setLabClientEnabled(enabled: boolean): void
  reset(): void
  close(): Promise<void>
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A lab origin as deploy/Caddyfile's lab_origin serves it: static JSON, CORS and timing for the site, never cached. */
function labOriginServer(
  target: LabTarget,
  siteOrigin: () => string,
  record: (url: string) => void,
  edgeTiming: () => boolean,
): Server {
  return createServer(async (req, res) => {
    record(req.url ?? '/')
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const headers = {
      'Access-Control-Allow-Origin': siteOrigin(),
      Vary: 'Origin',
      'Timing-Allow-Origin': siteOrigin(),
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'no-store',
      // Host nginx adds its cache status to every proxied response, lab origins included (always a MISS).
      ...(edgeTiming() ? { 'Server-Timing': 'edge;desc=MISS' } : {}),
    }
    try {
      const body = await readFile(join(LAB_ORIGINS, target, normalize(pathname).replace(/^\/+/, '')))
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(body)
    } catch {
      res.writeHead(404, headers).end('not found')
    }
  })
}

/** Static server for dist/ with a controllable service worker script. One per Playwright worker, on its own port. */
export async function startServer(): Promise<TestServer> {
  let bump = 0
  let edgeTiming = true
  let workerOverride: string | null = null
  let siteUrl = ''
  let labClientEnabled = false
  const labSeen = Object.fromEntries(LAB_TARGETS.map((target) => [target, [] as string[]])) as Record<
    LabTarget,
    string[]
  >
  const labServers = LAB_TARGETS.map((target) =>
    labOriginServer(
      target,
      () => siteUrl,
      (url) => {
        labSeen[target].push(url)
      },
      () => edgeTiming,
    ),
  )
  const labUrls = await Promise.all(labServers.map(listen))
  const labOrigins = Object.fromEntries(LAB_TARGETS.map((target, i) => [target, labUrls[i]])) as Record<
    LabTarget,
    string
  >

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const file = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^\/+/, '')
    if (file === 'lab/config.json') {
      // The production config, with each target's origin swapped for its local stand-in.
      const config = JSON.parse(await readFile(LAB_CONFIG, 'utf8')) as {
        client: Record<string, number | boolean>
        targets: { id: LabTarget; origin: string }[]
      }
      for (const target of config.targets) target.origin = labOrigins[target.id]
      // Same behaviour, shorter clock: tests should not wait out a 15 s circuit.
      config.client = {
        ...config.client,
        enabled: labClientEnabled,
        pollIntervalMs: 300,
        requestTimeoutMs: 800,
        backoffBaseMs: 40,
        backoffCapMs: 160,
        maxRetryAfterMs: 1500,
        circuitOpenMs: 2500,
      }
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
        .end(JSON.stringify(config))
      return
    }
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

  siteUrl = await listen(server)

  return {
    url: siteUrl,
    labOrigins,
    labRequests: (target, marker) =>
      labSeen[target].filter((url) => marker === undefined || url.includes(marker)).length,
    setLabClientEnabled: (enabled) => {
      labClientEnabled = enabled
    },
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
      labClientEnabled = false
      for (const target of LAB_TARGETS) labSeen[target] = []
    },
    close: async () => {
      await Promise.all(
        [server, ...labServers].map(
          (instance) =>
            new Promise<void>((resolve) => {
              instance.closeAllConnections()
              instance.close(() => resolve())
            }),
        ),
      )
    },
  }
}
