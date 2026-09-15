import { expect, expectControlled, test } from '../support/fixtures.ts'

// A clean console is part of the hacker persona's credibility: visitors who open devtools should find only what
// they bring (extensions). Firefox's font sanitiser warnings for Fontsource's Rajdhani went unnoticed this way.
test('the home page logs nothing to the console', async ({ page }) => {
  const messages: string[] = []
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

  await page.goto('/')
  await expectControlled(page)
  await page.locator('footer').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')

  expect(messages).toEqual([])
})
