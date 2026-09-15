import type { Page } from '@playwright/test'
import {
  expect,
  expectControlled,
  FIREFOX_PASSIVE_NAVIGATION,
  openEventLog,
  readEventLog,
  test,
} from '../support/fixtures.ts'

/** fetch() from the page with a unique marker; returns what the network actually answered. */
async function probe(page: Page, marker: string) {
  return page.evaluate(async (query) => {
    const response = await fetch(`/index.html?${query}`, { cache: 'no-store' })
    const body = await response.text()
    return {
      status: response.status,
      serverTiming: response.headers.get('server-timing'),
      isIndex: body.includes('id="root"'),
    }
  }, marker)
}

const fetchRow = (detail: string | RegExp) =>
  expect.objectContaining({ source: 'WORKER', tag: 'fetch', event: 'fetch', detail: expect.stringMatching(detail) })

test.describe('passive fetch observer', () => {
  test('observes requests from a controlled page without answering them', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)

    const marker = `probe=${Date.now()}`
    const response = await probe(page, marker)
    // The test server's own headers and body: the request reached the network, not a worker-built response.
    expect(response).toEqual({ status: 200, serverTiming: 'edge;desc=MISS', isIndex: true })

    await openEventLog(page)
    await expect.poll(() => readEventLog(page)).toContainEqual(fetchRow(`^GET /index\\.html\\?${marker} · fetch$`))
  })

  test('reports the page load itself once the new page exists', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)
    await page.goto('/')
    await expectControlled(page)

    // The navigation's fetch event fires before its page exists; the worker holds the row until it can deliver it.
    const marker = `nav=${Date.now()}`
    await page.goto(`/?${marker}`)
    await expectControlled(page)
    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toEqual(
        expect.arrayContaining([
          fetchRow(`^GET /\\?${marker} · navigate$`),
          fetchRow(/^GET \/assets\/index-.*\.js · script$/),
        ]),
      )
    await expect(page.getByTestId('strip-ttfb')).toHaveAttribute('title', /via service worker, startup \d+ ms$/)
  })

  test('delivers each tab only its own requests', async ({ page, context, browserName }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)
    await page.goto('/')
    await expectControlled(page)
    const other = await context.newPage()
    await other.goto('/')
    await expectControlled(other)

    await probe(page, 'tab=first')
    await probe(other, 'tab=second')

    await openEventLog(page)
    await openEventLog(other)
    await expect.poll(() => readEventLog(page)).toContainEqual(fetchRow(/tab=first/))
    await expect.poll(() => readEventLog(other)).toContainEqual(fetchRow(/tab=second/))
    expect(await readEventLog(page)).not.toContainEqual(fetchRow(/tab=second/))
    expect(await readEventLog(other)).not.toContainEqual(fetchRow(/tab=first/))
  })

  test('a first visit reports that it was not routed through a service worker', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('strip-ttfb')).toHaveAttribute('title', /not routed through a service worker$/)
  })

  test('log tags can be hidden, and the choice persists', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
    await probe(page, 'tagged=1')
    await openEventLog(page)
    await expect.poll(() => readEventLog(page)).toContainEqual(fetchRow(/tagged=1/))

    const fetchToggle = page.getByRole('button', { name: 'FETCH', exact: true })
    await fetchToggle.click()
    await expect(fetchToggle).toHaveAttribute('aria-pressed', 'false')
    const rows = await readEventLog(page)
    expect(rows.some((row) => row.tag === 'fetch')).toBe(false)
    expect(rows).toContainEqual(expect.objectContaining({ tag: 'lifecycle', event: 'register:complete' }))
    await expect(page.getByTestId('sw-log-count')).toHaveText(/^\d+ shown · \d+ \/ 200 · UTC$/)

    await page.reload()
    await openEventLog(page)
    await expect(page.getByRole('button', { name: 'FETCH', exact: true })).toHaveAttribute('aria-pressed', 'false')
  })

  test('request rows are evicted before lifecycle history', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
    await openEventLog(page)
    await expect.poll(() => readEventLog(page)).toContainEqual(expect.objectContaining({ event: 'handshake' }))

    await page.evaluate(async () => {
      await Promise.all(Array.from({ length: 230 }, (_, i) => fetch(`/index.html?flood=${i}`, { cache: 'no-store' })))
    })
    await expect(page.getByTestId('sw-log-count')).toHaveText(/ 200 \/ 200 · UTC$/)
    const rows = await readEventLog(page)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: 'lifecycle', event: 'register:start' }),
        expect.objectContaining({ tag: 'control', event: 'handshake' }),
      ]),
    )
  })
})
