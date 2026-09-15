import { execFileSync } from 'node:child_process'
import { expect, test } from '../support/fixtures.ts'

test.describe('systems strip telemetry', () => {
  test('reports real build, document, and worker state', async ({ page }) => {
    await page.goto('/')

    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
    await expect(page.getByTestId('strip-build')).toHaveText(new RegExp(`^BUILD: ${sha}\\*?$`))
    await expect(page.getByTestId('strip-sw')).toHaveText('SW: CONTROLLING')

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
