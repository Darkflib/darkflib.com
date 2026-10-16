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

// The access pages and the tools index under the same policy, with deploy/scripts/auth-stub.Caddyfile standing in for
// wwff-auth: signed out at /login/, signed in (its smoke=1 cookie) through forward_auth at /tools/.
test('the access pages run under production headers without CSP violations', async ({ page, context }) => {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') violations.push(message.text())
  })
  await page.exposeFunction('reportViolation', (violation: string) => violations.push(violation))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      )
    })
  })

  await page.goto('/login/')
  await expect(page.getByRole('heading', { name: 'Identify yourself.' })).toBeVisible()
  // The grid paints: the canvas has a backing store sized to the scene.
  expect(await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0)

  await page.goto('/tools/')
  await expect(page).toHaveURL(/\/login\/\?next=\/tools\/$/)

  await context.addCookies([{ name: 'smoke', value: '1', domain: 'darkflib.com', path: '/' }])
  await page.goto('/tools/')
  await expect(page.getByText('Signed in as Smoke, with GitHub.')).toBeVisible()

  // Only the tools the stand-in's /auth/tools lists, with the one that needs a step-up marked.
  await expect(page.getByRole('link', { name: /SESSION DEBUGGER/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /STEPUP/ })).toHaveAttribute('href', /\/login\/step-up\//)
  await expect(page.getByText('Needs a passkey first.')).toBeVisible()

  // The gate's refusals as pages: no role for the tool, and a role that needs a step-up.
  await page.goto('/tools/locked/')
  await expect(page).toHaveURL(
    /\/login\/denied\/\?next=%2Ftools%2Flocked%2F$|\/login\/denied\/\?next=\/tools\/locked\/$/,
  )
  await expect(page.getByText('Your account has no role that opens LOCKED.')).toBeVisible()
  await page.goto('/tools/stepup/')
  await expect(page).toHaveURL(/\/login\/step-up\//)
  await expect(page.getByText('STEPUP needs a passkey from the last 15 minutes.')).toBeVisible()
  // A role that needs a fresh GitHub/Google sign-in starts that sign-in directly: /login/ would only offer CONTINUE to
  // a session that is already signed in.
  await page.goto('/tools/reauth/')
  await expect(page.getByText('REAUTH needs a GitHub or Google sign-in from the last 12 hours.')).toBeVisible()
  await expect(page.getByRole('link', { name: /SIGN IN AGAIN WITH GITHUB/ })).toHaveAttribute(
    'href',
    '/auth/github/start?next=%2Ftools%2Freauth%2F',
  )
  // User admin: search, open a user, grantable roles as toggles and admin read-only, and a credit adjustment.
  await page.goto('/tools/users/')
  await page.getByRole('button', { name: /Alice Example/ }).click()
  await expect(page).toHaveURL(/\/tools\/users\/\?user=u2$/)
  await expect(page.getByRole('checkbox', { name: 'user' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'admin (command line only)' })).toBeDisabled()
  await page.getByRole('spinbutton', { name: 'Amount' }).fill('5')
  await page.getByRole('textbox', { name: 'Note' }).fill('smoke')
  await page.getByRole('button', { name: 'APPLY' }).click()
  await expect(page.getByText('domain: +5, balance now 8.')).toBeVisible()

  // Domain recon: a run renders each check's summary or its error, and the balance after it.
  await page.goto('/tools/domain/')
  await expect(page.getByText('Costs 1 credit. Balance: 3')).toBeVisible()
  await page.getByRole('textbox', { name: 'Domain' }).fill('example.com')
  await page.getByRole('button', { name: 'RUN' }).click()
  const registration = page.getByRole('region', { name: 'REGISTRATION' })
  await expect(registration).toContainText('RESERVED-Internet Assigned Numbers Authority')
  await expect(page.getByRole('region', { name: 'TLS' })).toContainText('TIMEOUT')
  await expect(page.getByText('Costs 1 credit. Balance: 2')).toBeVisible()

  await page.goto('/tools/')
  await expect(page.getByText('Credits: domain 3')).toBeVisible()

  // The session debugger: the forwarded headers and the stand-in's passkey render, and a FEDERATED-only session
  // would be asked to step up for anything that needs a passkey.
  await page.getByRole('link', { name: /SESSION DEBUGGER/ }).click()
  await expect(page).toHaveURL(/\/tools\/debug\/$/)
  await expect(page.getByRole('cell', { name: 'smoke-user' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Smoke key' })).toBeVisible()
  await expect(page.getByRole('row', { name: /STANDARD within 10m/ })).toContainText('STEP-UP: missing')
  await expect(page.getByRole('row', { name: /FEDERATED within/ })).toContainText('PASS')

  // Linked accounts: the stand-in's GitHub identity is listed, and neither Unlink nor Link Google works until there is
  // a passkey (the stand-in's session has none), which the panel says.
  const accounts = page.getByRole('region', { name: '// LINKED ACCOUNTS' })
  await expect(accounts.getByRole('row', { name: /GitHub/ })).toContainText('smoke')
  await expect(accounts.getByRole('button', { name: 'Unlink' })).toBeDisabled()
  await expect(accounts.getByRole('button', { name: 'Link Google' })).toBeDisabled()
  await expect(accounts.getByText('Linking and unlinking need a passkey.')).toBeVisible()

  expect(violations).toEqual([])
})
