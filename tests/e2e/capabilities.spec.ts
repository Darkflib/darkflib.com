import { WORKER_CAPABILITIES } from '../../src/sw/protocol.ts'
import { expect, expectControlled, openEventLog, readEventLog, test } from '../support/fixtures.ts'

const everyCapability = Object.entries(WORKER_CAPABILITIES)
  .map(([name, version]) => `${name} v${version}`)
  .join(', ')
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A worker as deployed before the capabilities handshake existed: it answers hello with its build only.
const LEGACY_WORKER = `
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  const [port] = event.ports
  if (event.data && event.data.type === 'sw:hello' && port) port.postMessage({ type: 'sw:hello:reply', version: 'legacy+00000000' })
})
`

test.describe('worker capabilities', () => {
  test('the controlling worker reports what it supports', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
    const build = page.getByTestId('sw-build')
    await expect(build).toHaveAttribute('title', `Capabilities: ${everyCapability}`)
    await expect(build).not.toContainText('OUTDATED')
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING')
  })

  test('a worker from before the handshake is flagged as outdated', async ({ page, server }) => {
    server.setServiceWorkerOverride(LEGACY_WORKER)
    await page.goto('/')
    const build = page.getByTestId('sw-build')
    await expect(build).toHaveText('legacy+00000000 · OUTDATED')
    await expect(build).toHaveAttribute(
      'title',
      new RegExp(`^Outdated worker: this page needs ${escaped(everyCapability)}\\.`),
    )
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING · OUTDATED')

    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toContainEqual(
        expect.objectContaining({
          tag: 'control',
          event: 'handshake',
          detail: expect.stringMatching(
            new RegExp(`capabilities none; outdated, missing ${escaped(everyCapability)}$`),
          ),
        }),
      )
  })
})
