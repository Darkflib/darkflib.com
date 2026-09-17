import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

interface KevFeedPluginOptions {
  /** A real snapshot, written by `npm run kev`; served as-is when it exists. */
  local?: string
  /** The committed sample, used when there is no local snapshot. Its fetched_at is rewritten to now. */
  fixture?: string
}

/**
 * Serves `/feeds/kev.json` in development, where Caddy and the darkflib-feeds volume do not exist. Nothing is emitted
 * into the build: in production the file comes from the volume, never from dist/.
 *
 * With neither file present the answer is 204, exactly as deploy/Caddyfile answers an empty volume, so the "no
 * snapshot" path is the one a developer sees by default rather than a 404 nobody notices.
 */
/**
 * The committed sample, moved onto `now`: fetched_at becomes that moment and every date in it shifts by the same
 * amount, so its shape — what arrived this week, what is due soon — stays what it was when the snapshot was taken,
 * however long ago that was. Both stand-ins for the volume (this plugin and the Playwright test server) serve it this
 * way, which is what lets a test assert counts that would otherwise decay.
 */
export function rebaseSnapshot(sample: string, now = Date.now()): string {
  const snapshot = JSON.parse(sample) as {
    fetched_at: string
    entries: { added: string; due?: string | null }[]
  }
  const offset = now - Date.parse(snapshot.fetched_at)
  const shift = (iso: string) => new Date(Date.parse(iso) + offset).toISOString()
  return JSON.stringify({
    ...snapshot,
    fetched_at: new Date(now).toISOString(),
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      added: shift(entry.added),
      ...(entry.due ? { due: shift(`${entry.due}T00:00:00Z`).slice(0, 10) } : {}),
    })),
  })
}

export function kevFeedPlugin({
  local = '.feeds/kev.json',
  fixture = 'tests/fixtures/kev.json',
}: KevFeedPluginOptions = {}): Plugin {
  return {
    name: 'darkflib:kev-feed',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use('/feeds/kev.json', (_req, res, next) => {
        const send = (body: string) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(body)
        }
        readFile(local, 'utf8').then(send, () =>
          readFile(fixture, 'utf8').then(
            (sample) => {
              try {
                send(JSON.stringify({ ...JSON.parse(sample), fetched_at: new Date().toISOString() }))
              } catch (error) {
                next(error)
              }
            },
            () => {
              res.statusCode = 204
              res.end()
            },
          ),
        )
      })
    },
  }
}
