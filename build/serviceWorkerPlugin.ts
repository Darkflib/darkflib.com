import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

const HASH_PLACEHOLDER = '__SW_BUNDLE_HASH__'

interface ServiceWorkerPluginOptions {
  /** Worker entry point, relative to the project root. */
  entry: string
  /** Served and emitted at this root-relative path. The URL must stay stable across builds. */
  fileName?: string
}

/**
 * Bundles the service worker as a single classic script, outside Vite's module graph: module workers are not
 * universally supported, and the script URL must not be content-hashed. Dev serves a fresh bundle per request, so
 * editing the worker exercises the real browser update flow.
 *
 * The worker sees `__SW_VERSION__` as `sw-<hash>`, a hash of the bundle itself (taken with a placeholder in the
 * version's place). Nothing else about the build goes in: no commit SHA, no timestamp. The bytes therefore change only
 * when the worker's code does, so a commit that leaves the worker alone deploys the same script and the browser finds
 * no update.
 */
export function serviceWorkerPlugin({ entry, fileName = 'service-worker.js' }: ServiceWorkerPluginOptions): Plugin {
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
      define: { __SW_VERSION__: JSON.stringify(`sw-${HASH_PLACEHOLDER}`) },
    })
    const code = result.outputFiles[0].text
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 8)
    // The minifier may inline the version at each use.
    return code.replaceAll(HASH_PLACEHOLDER, hash)
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
