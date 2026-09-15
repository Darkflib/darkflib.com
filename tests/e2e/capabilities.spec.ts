import { expect, expectControlled, openEventLog, readEventLog, test } from '../support/fixtures.ts'

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
    await expect(build).toHaveAttribute('title', /^Capabilities: .*fetch-observer v1/)
    await expect(build).not.toContainText('OUTDATED')
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING')
  })

  test('a worker from before the handshake is flagged as outdated', async ({ page, server }) => {
    server.setServiceWorkerOverride(LEGACY_WORKER)
    await page.goto('/')
    const build = page.getByTestId('sw-build')
    await expect(build).toHaveText('legacy+00000000 · OUTDATED')
    await expect(build).toHaveAttribute('title', /^Outdated worker: this page needs fetch-observer v1\./)
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING · OUTDATED')

    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toContainEqual(
        expect.objectContaining({
          tag: 'control',
          event: 'handshake',
          detail: expect.stringMatching(/capabilities none; outdated, missing fetch-observer v1$/),
        }),
      )
  })
})
