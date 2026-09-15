import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

const HASH_PLACEHOLDER = '__SW_BUNDLE_HASH__'

interface ServiceWorkerPluginOptions {
  /** Worker entry point, relative to the project root. */
  entry: string
  /** Served and emitted at this root-relative path. The URL must stay stable across builds. */
  fileName?: string
  /** Build identifier baked into the worker; the bundle hash is appended. */
  build: string
}

/**
 * Bundles the service worker as a single classic script, outside Vite's module graph: module workers are not
 * universally supported, and the script URL must not be content-hashed. Dev serves a fresh bundle per request, so
 * editing the worker exercises the real browser update flow.
 *
 * The worker sees `__SW_VERSION__` as `<build>+<hash>`, where the hash covers the bundle itself. Identical source
 * yields identical bytes, so rebuilding an unchanged worker never triggers a spurious update.
 */
export function serviceWorkerPlugin({
  entry,
  fileName = 'service-worker.js',
  build: buildId,
}: ServiceWorkerPluginOptions): Plugin {
  async function bundle(minify: boolean): Promise<string> {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      minify,
      write: false,
      logLevel: 'silent',
      define: { __SW_VERSION__: JSON.stringify(`${buildId}+${HASH_PLACEHOLDER}`) },
    })
    const code = result.outputFiles[0].text
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 8)
    return code.replace(HASH_PLACEHOLDER, hash)
  }

  return {
    name: 'darkflib:service-worker',

    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res, next) => {
        bundle(false).then((code) => {
          res.setHeader('Content-Type', 'text/javascript')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(code)
        }, next)
      })
    },

    async generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: await bundle(true) })
    },
  }
}
