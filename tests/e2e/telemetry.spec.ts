import { expect, test } from '../support/fixtures.ts'

test.describe('systems strip telemetry', () => {
  test('reports real build, document, and worker state', async ({ page }) => {
    await page.goto('/')

    const strip = page.getByTestId('strip-build')
    await expect(strip).toHaveText(/^BUILD: [0-9a-f]{7}\*?$/)
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING')

    // Page and worker come from the same build. (dist/ may predate HEAD locally, so don't compare with git here.)
    const [, sha, dirty] = /^BUILD: ([0-9a-f]{7})(\*?)$/.exec((await strip.textContent()) ?? '') ?? []
    await expect(page.getByTestId('sw-build')).toHaveText(new RegExp(`^${sha}${dirty ? '-dirty' : ''}\\+[0-9a-f]{8}$`))

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

  test('marks the worker as off when disabled', async ({ page }) => {
    await page.goto('/?sw=off')
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: OFF')
  })
})
