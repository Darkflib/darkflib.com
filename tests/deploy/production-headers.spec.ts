import { expect, test } from '@playwright/test'

// Runs against the real image (deploy/scripts/smoke.sh with KEEP=1), not the Node test server, so the page is loaded
// under the Caddyfile's actual CSP and cache headers. See playwright.deploy.config.ts for the host mapping.
test('the site runs under production headers without CSP violations', async ({ page }) => {
  const violations: string[] = []
  await page.exposeFunction('reportViolation', (violation: string) => violations.push(violation))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      )
    })
  })

  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")

  // The service worker registers and controls the page under worker-src 'self'.
  await expect(page.getByTestId('sw-status')).toHaveText('CONTROLLING THIS PAGE', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')

  // Self-hosted fonts, the hero image, and CSSOM-set bar heights all survive the policy.
  expect(await page.evaluate(() => document.fonts.check('16px "IBM Plex Mono"'))).toBe(true)
  expect(await page.locator('.hero-art img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  const heights = await page
    .getByTestId('strip-requests')
    .locator('i:not(.empty)')
    .evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().height))
  expect(Math.max(...heights)).toBeGreaterThan(3)

  expect(violations).toEqual([])
})
