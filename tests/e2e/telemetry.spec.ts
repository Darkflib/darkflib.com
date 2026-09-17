import { createHash } from 'node:crypto'
import { expect, test } from '../support/fixtures.ts'

test.describe('systems strip telemetry', () => {
  test('reports real build, document, and worker state', async ({ page }) => {
    await page.goto('/')

    const strip = page.getByTestId('strip-build')
    await expect(strip).toHaveText(/^BUILD: [0-9a-f]{7}\*?$/)
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING')

    const [, sha, dirty] = /^BUILD: ([0-9a-f]{7})(\*?)$/.exec((await strip.textContent()) ?? '') ?? []

    // The worker's version is a hash of its own bytes, with the version as a placeholder, and nothing else: recompute it
    // from the script served. (That the commit stays out is the point: an unchanged worker must not update.)
    const script = await (await page.request.get('/service-worker.js')).text()
    const versions = [...new Set(script.match(/sw-[0-9a-f]{8}/g))]
    expect(versions).toHaveLength(1)
    const hash = createHash('sha256')
      .update(script.replaceAll(versions[0], 'sw-__SW_BUNDLE_HASH__'))
      .digest('hex')
      .slice(0, 8)
    expect(versions[0]).toBe(`sw-${hash}`)
    expect(script).not.toContain(sha)
    await expect(page.getByTestId('sw-version')).toHaveText(`sw-${hash}`)

    // In CI the build runs right before the tests, from a clean checkout of the commit under test.
    if (process.env.GITHUB_SHA) {
      expect(sha).toBe(process.env.GITHUB_SHA.slice(0, 7))
      expect(dirty).toBe('')
    }

    // The test server speaks HTTP/1.1; all three engines expose nextHopProtocol.
    await expect(page.getByTestId('strip-protocol')).toHaveText('PROTO: HTTP/1.1')
    await expect(page.getByTestId('strip-ttfb')).toHaveText(/^TTFB: \d+ MS/)
  })

  test('plots one bar per subresource request', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const bars = page.getByTestId('strip-requests').locator('i:not(.empty)')
    // At minimum: the script, stylesheet, fonts, and hero and project images.
    await expect.poll(() => bars.count()).toBeGreaterThanOrEqual(6)
    await expect(page.getByTestId('strip-requests')).toHaveAttribute(
      'aria-label',
      /^Request latency, last \d+ requests, slowest \d+ ms$/,
    )
  })

  test('reports the edge cache status of network-fetched subresources', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const edge = page.getByTestId('strip-edge')
    await expect(edge).toHaveText(/^EDGE: \d+\/\d+ HIT$/)
    const [, hits, total] = /^EDGE: (\d+)\/(\d+)/.exec((await edge.textContent()) ?? '') ?? []
    expect(Number(hits)).toBeGreaterThanOrEqual(6)
    // Everything this server marks cacheable is a HIT. WebKit alone also lists the worker script fetch as a page
    // resource, which is correctly a MISS (the worker is never edge-cached), so allow at most that one.
    expect(Number(total) - Number(hits)).toBeLessThanOrEqual(1)
    await expect(edge).toHaveAttribute(
      'title',
      /^Edge cache: document: MISS; network-fetched subresources: \d+ HIT(, 1 MISS)?$/,
    )
  })

  test('does not replay stale edge results for subresources served from the browser cache', async ({
    page,
    browserName,
  }) => {
    // Measured: Playwright's WebKit re-requests every subresource from this plain-HTTP test server on the second
    // navigation (the server logs each request, and transferSize is the full size), so there is no browser-cache case
    // to observe. Against the live HTTPS site it does use its cache. Chromium and Firefox exercise this path.
    test.skip(browserName === 'webkit', 'WebKit refetches subresources from the test server; nothing is cached')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('strip-edge')).toHaveText(/HIT$/)

    // Second navigation: the document revalidates (no-cache); hashed assets and images are fresh in the HTTP cache,
    // and their replayed Server-Timing must not be reported as fresh edge hits.
    await page.goto('/?again')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('strip-edge')).toHaveText('EDGE: LOCAL')
  })

  test('shows a dash when nothing in front of the origin reports edge status', async ({ page, server }) => {
    server.setEdgeTiming(false)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('strip-edge')).toHaveText('EDGE: —')
  })

  test('marks the worker as off when disabled', async ({ page }) => {
    await page.goto('/?sw=off')
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: OFF')
  })
})
