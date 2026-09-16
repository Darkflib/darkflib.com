import type { Page, Route } from '@playwright/test'
import { expect, test } from '../support/fixtures.ts'

// The form posts to mikepreston.org's contact API; these stand in for it, with the CORS headers a cross-origin
// request needs (preflight included, since the POST sends JSON).
//
// Every page here loads with ?sw=off. WebKit sends a controlled page's fetches through the service worker, and
// Playwright cannot intercept those, so the stub would be bypassed and the real API called.
const ORIGIN = 'https://mikepreston.org'
const TOKEN_URL = `${ORIGIN}/api/v1/contact/token`
const SUBMIT_URL = `${ORIGIN}/api/v1/contact`

// WebKit refuses a wildcard here, so echo the page's own origin, as the API does for an allowed site.
const cors = (route: Route) => ({
  'access-control-allow-origin': route.request().headers().origin ?? '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
})

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: cors(route), body: JSON.stringify(body) })

interface Stub {
  tokenStatus?: number
  submitStatus?: number
}

async function stubApi(page: Page, { tokenStatus = 200, submitStatus = 200 }: Stub = {}) {
  const posted: unknown[] = []
  const tokens: string[] = []
  // Nothing in a test may reach the real service: anything not stubbed below fails here.
  await page.route(`${ORIGIN}/**`, (route) => route.abort())
  await page.route(TOKEN_URL, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) })
    if (tokenStatus !== 200) return json(route, tokenStatus, { detail: 'nope' })
    tokens.push('issued')
    return json(route, 200, { token: 'test-token', issued_at: new Date().toISOString() })
  })
  await page.route(SUBMIT_URL, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) })
    posted.push(route.request().postDataJSON())
    return json(route, submitStatus, submitStatus === 200 ? { ok: true } : { detail: 'nope' })
  })
  return { posted, tokens }
}

async function fillForm(page: Page) {
  await page.getByLabel('NAME').fill('Ada Lovelace')
  await page.getByLabel('EMAIL').fill('ada@example.com')
  await page.getByLabel('SUBJECT').fill('Fault Lab')
  await page.getByLabel('MESSAGE').fill('The circuit breaker demo is a nice touch.')
}

test('the contact dialog opens from the nav and the CONNECT card, and sends a message', async ({ page }) => {
  const { posted, tokens } = await stubApi(page)
  await page.goto('/?sw=off')

  const dialog = page.getByRole('dialog', { name: 'SAY HELLO' })
  await page.getByRole('link', { name: 'CONTACT' }).click()
  await expect(dialog).toBeVisible()
  // The link opens the dialog rather than scrolling to the CONNECT panel.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'OPEN CHANNEL' }).click()
  await expect(dialog).toBeVisible()

  await fillForm(page)
  await page.getByRole('button', { name: 'SEND' }).click()
  await expect(page.getByTestId('contact-sent')).toBeVisible()

  expect(posted).toHaveLength(1)
  expect(posted[0]).toEqual({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    subject: 'Fault Lab',
    message: 'The circuit breaker demo is a nice touch.',
    // The honeypot goes up empty, and the single-use form token comes from the API.
    website: '',
    token: 'test-token',
    signals: { keystrokes: expect.any(Number), focus_events: expect.any(Number), pointer_moved: expect.any(Boolean) },
  })

  // No second token while the confirmation is on screen: that one would be issued for a form nobody is filling in.
  await page.waitForTimeout(300)
  expect(tokens).toHaveLength(1)

  await page.getByRole('button', { name: 'CLOSE', exact: true }).click()
  await expect(dialog).toBeHidden()

  // Reopening starts a fresh form, so it takes a fresh single-use token.
  await page.getByRole('button', { name: 'OPEN CHANNEL' }).click()
  await expect.poll(() => tokens.length).toBe(2)
})

test('the form checks itself before spending a token', async ({ page }) => {
  const { posted } = await stubApi(page)
  await page.goto('/?sw=off')
  await page.getByRole('link', { name: 'CONTACT' }).click()

  await page.getByRole('button', { name: 'SEND' }).click()
  await expect(page.getByText('Required.')).toHaveCount(3)
  await expect(page.getByText('At least 10 characters.')).toBeVisible()
  expect(posted).toHaveLength(0)

  await page.getByLabel('NAME').fill('Ada')
  await page.getByLabel('EMAIL').fill('not-an-address')
  await page.getByLabel('SUBJECT').fill('Hello')
  await page.getByLabel('MESSAGE').fill('Long enough to pass.')
  await page.getByRole('button', { name: 'SEND' }).click()
  await expect(page.getByText('Not a valid address.')).toBeVisible()
  expect(posted).toHaveLength(0)
})

test('a rate-limited submission says so and keeps what was typed', async ({ page }) => {
  await stubApi(page, { submitStatus: 429 })
  await page.goto('/?sw=off')
  await page.getByRole('link', { name: 'CONTACT' }).click()
  await fillForm(page)
  await page.getByRole('button', { name: 'SEND' }).click()

  await expect(page.getByTestId('contact-rate-limited')).toBeVisible()
  await expect(page.getByLabel('MESSAGE')).toHaveValue('The circuit breaker demo is a nice touch.')
})

test('a failing submission offers the form on mikepreston.org', async ({ page }) => {
  await stubApi(page, { submitStatus: 500 })
  await page.goto('/?sw=off')
  await page.getByRole('link', { name: 'CONTACT' }).click()
  await fillForm(page)
  await page.getByRole('button', { name: 'SEND' }).click()

  const notice = page.getByTestId('contact-error')
  await expect(notice).toBeVisible()
  await expect(notice.getByRole('link')).toHaveAttribute('href', 'https://mikepreston.org/contact')
})

test('with the API unreachable the form does not pretend it can send', async ({ page }) => {
  await stubApi(page, { tokenStatus: 503 })
  await page.goto('/?sw=off')
  await page.getByRole('link', { name: 'CONTACT' }).click()

  await expect(page.getByTestId('contact-token-failed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'SEND' })).toBeDisabled()
})
