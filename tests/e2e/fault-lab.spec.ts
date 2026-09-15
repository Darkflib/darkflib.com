import type { Page } from '@playwright/test'
import { expect, expectControlled, openEventLog, readEventLog, test } from '../support/fixtures.ts'

// The test server's /lab/config.json shortens the client's clock: 300 ms polls, 800 ms timeouts, a 2.5 s circuit
// cool-off, and Retry-After waited out up to 1.5 s. Behaviour is otherwise the production client's.
const SLOW = { timeout: 12_000 }

const LEGACY_WORKER = `
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  const [port] = event.ports
  if (event.data && event.data.type === 'sw:hello' && port) port.postMessage({ type: 'sw:hello:reply', version: 'legacy+00000000' })
})
`

async function choose(page: Page, label: string, fault: string) {
  await page.getByLabel(`Fault for ${label}`).selectOption(fault)
}

async function logEvents(page: Page) {
  await openEventLog(page)
  return (await readEventLog(page)).filter((row) => row.tag === 'client' || row.tag === 'fault')
}

const event = (name: string, detail?: string | RegExp) =>
  expect.objectContaining({ event: name, ...(detail ? { detail: expect.stringMatching(detail) } : {}) })

test.describe('fault lab', () => {
  test.beforeEach(async ({ page, server }) => {
    server.setLabClientEnabled(true)
    await page.goto('/')
    await expectControlled(page)
    await expect(page.getByTestId('lab-state')).toHaveText('HEALTHY', SLOW)
  })

  test('starts healthy, served by the primary, with nothing injected', async ({ page }) => {
    await expect(page.getByTestId('lab-served-by')).toHaveText(/^PRIMARY API · /)
    await expect(page.getByTestId('lab-media')).toHaveText('HEALTHY', SLOW)
    for (const id of ['api-primary', 'api-secondary', 'media']) {
      await expect(page.getByTestId(`lab-circuit-${id}`)).toHaveText('CLOSED')
      await expect(page.getByTestId(`lab-applied-${id}`)).toHaveText('—')
    }
    await expect(page.getByRole('button', { name: 'RESET LAB' })).toBeDisabled()
    await expect(page.getByTestId('lab-unavailable')).toHaveCount(0)
  })

  test('primary offline: retries, opens the circuit, and fails over without touching the origin', async ({
    page,
    server,
  }) => {
    await choose(page, 'PRIMARY API', 'offline')
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('ACTIVE · OFFLINE')
    const primaryBefore = server.labRequests('api-primary')
    const secondaryBefore = server.labRequests('api-secondary')

    await expect(page.getByTestId('lab-state')).toHaveText('FAILOVER', SLOW)
    await expect(page.getByTestId('lab-served-by')).toHaveText(/^SECONDARY API · /)
    await expect(page.getByTestId('lab-circuit-api-primary')).toHaveText('OPEN', SLOW)
    expect(server.labRequests('api-primary')).toBe(primaryBefore)
    expect(server.labRequests('api-secondary')).toBeGreaterThan(secondaryBefore)

    await expect
      .poll(() => logEvents(page), SLOW)
      .toEqual(
        expect.arrayContaining([
          event('faults:set', /active: .* offline$/),
          event('fault:offline', /simulated network failure; no request sent$/),
          event('retry', /^PRIMARY API: network error; attempt 2 in \d+ ms \(backoff\)$/),
          event('call:failed', /^PRIMARY API: network error after 3 attempt\(s\)$/),
          event('circuit:open', /^PRIMARY API: refusing calls for \d+ s$/),
          event('state:failover', /served by SECONDARY API$/),
        ]),
      )
  })

  test('clearing the fault lets the circuit half-open, close, and recover', async ({ page }) => {
    await choose(page, 'PRIMARY API', 'offline')
    await expect(page.getByTestId('lab-circuit-api-primary')).toHaveText('OPEN', SLOW)

    await choose(page, 'PRIMARY API', 'none')
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('—')
    await expect(page.getByTestId('lab-state')).toHaveText('HEALTHY', SLOW)
    await expect(page.getByTestId('lab-circuit-api-primary')).toHaveText('CLOSED')
    await expect
      .poll(() => logEvents(page), SLOW)
      .toEqual(
        expect.arrayContaining([
          event('circuit:half-open', /^PRIMARY API: allowing one trial call$/),
          event('circuit:closed', /^PRIMARY API: calls flowing again$/),
          event('state:healthy', /^served by PRIMARY API$/),
        ]),
      )
  })

  test('both APIs and media offline: stale data and degraded media, then reset recovers', async ({ page }) => {
    await choose(page, 'PRIMARY API', 'offline')
    await choose(page, 'SECONDARY API', 'offline')
    await choose(page, 'MEDIA EDGE', 'offline')
    await expect(page.getByTestId('lab-state')).toHaveText('STALE DATA', SLOW)
    await expect(page.getByTestId('lab-media')).toHaveText('DEGRADED', SLOW)
    await openEventLog(page)
    const note = page.getByTestId('sw-log-note')
    await expect(note).toHaveText(/Fault injection is active for 127\.0\.0\.1:\d+, 127\.0\.0\.1:\d+, 127\.0\.0\.1:\d+:/)

    await page.getByRole('button', { name: 'RESET LAB' }).click()
    for (const id of ['api-primary', 'api-secondary', 'media']) {
      await expect(page.getByTestId(`lab-applied-${id}`)).toHaveText('—')
    }
    await expect(note).toHaveText(/No fault injection is active\.$/)
    // Circuits opened during the outage must cool off before trial calls succeed.
    await expect(page.getByTestId('lab-state')).toHaveText('HEALTHY', SLOW)
    await expect(page.getByTestId('lab-media')).toHaveText('HEALTHY', SLOW)
  })

  test('503 with a short Retry-After: the client waits exactly that long before retrying', async ({ page }) => {
    await choose(page, 'PRIMARY API', 'http-503')
    await page.getByLabel('Retry-After for PRIMARY API').selectOption('1')
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('ACTIVE · HTTP 503')
    await expect
      .poll(() => logEvents(page), SLOW)
      .toContainEqual(event('retry', /^PRIMARY API: HTTP 503 in \d+ ms; attempt 2 in 1000 ms \(Retry-After\)$/))
  })

  test('429 with a long Retry-After: the client stops calling until it has passed', async ({ page }) => {
    await choose(page, 'PRIMARY API', 'http-429')
    await page.getByLabel('Retry-After for PRIMARY API').selectOption('10')
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('ACTIVE · HTTP 429')
    await expect(page.getByTestId('lab-circuit-api-primary')).toHaveText('OPEN', SLOW)
    await expect(page.getByTestId('lab-state')).toHaveText('FAILOVER', SLOW)
    await expect
      .poll(() => logEvents(page), SLOW)
      .toContainEqual(event('retry-after', /^PRIMARY API: HTTP 429 in \d+ ms, backing off 10 s$/))
  })

  test('latency beyond the client timeout reads as timeouts and fails over; below it, just slower', async ({
    page,
  }) => {
    await choose(page, 'MEDIA EDGE', 'latency')
    await page.getByLabel('Latency for MEDIA EDGE').selectOption('250')
    await expect(page.getByTestId('lab-view-media')).toHaveText(/^200 in (2[5-9]\d|[3-7]\d\d) ms$/, SLOW)
    await expect(page.getByTestId('lab-media')).toHaveText('HEALTHY')

    await choose(page, 'PRIMARY API', 'latency')
    await page.getByLabel('Latency for PRIMARY API').selectOption('2500')
    await expect(page.getByTestId('lab-view-api-primary')).toHaveText(/^timeout after \d+ ms$/, SLOW)
    await expect(page.getByTestId('lab-state')).toHaveText('FAILOVER', SLOW)
  })

  test('re-sends the rules when the worker restarts and loses them', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'stopping a service worker on demand needs the Chrome DevTools Protocol')
    await choose(page, 'PRIMARY API', 'offline')
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('ACTIVE · OFFLINE')

    const cdp = await context.newCDPSession(page)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')

    await expect
      .poll(() => logEvents(page), SLOW)
      .toContainEqual(event('faults:reapplied', /^worker had lost its rules; active: .* offline$/))
    await expect(page.getByTestId('lab-applied-api-primary')).toHaveText('ACTIVE · OFFLINE')
    await expect(page.getByTestId('lab-state')).toHaveText('FAILOVER', SLOW)
  })
})

test('with an older worker the lab explains why, and the status client still runs', async ({ page, server }) => {
  server.setServiceWorkerOverride(LEGACY_WORKER)
  server.setLabClientEnabled(true)
  await page.goto('/')
  await expect(page.getByTestId('lab-unavailable')).toHaveText(/older service worker without fault injection/, SLOW)
  await expect(page.getByLabel('Fault for PRIMARY API')).toBeDisabled()
  await expect(page.getByTestId('lab-state')).toHaveText('HEALTHY', SLOW)
})

test('with polling switched off in the config, the lab is idle and this page makes no lab requests', async ({
  page,
  server,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('lab-state')).toHaveText('IDLE', SLOW)
  await page.waitForTimeout(1000)
  // This page's own Resource Timing, not the origins' request counters: a delayed request from a previous test's
  // latency fault can still land on the shared stand-in servers.
  const labOrigins = Object.values(server.labOrigins)
  const labRequests = await page.evaluate(
    (origins) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => origins.some((origin) => name.startsWith(origin))),
    labOrigins,
  )
  expect(labRequests).toEqual([])
})
