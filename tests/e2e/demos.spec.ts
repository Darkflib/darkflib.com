import { CATALOGUE, demoPath } from '../../src/demos/catalogue.ts'
import { CONCEPTS } from '../../src/demos/concepts/index.ts'
import { expect, test } from '../support/fixtures.ts'

test('the index links every demo, in catalogue order', async ({ page }) => {
  await page.goto('/demos/')
  await expect(page.getByRole('heading', { name: 'DEMOS', level: 1 })).toBeVisible()
  const hrefs = await page.locator('.demos-card a').evaluateAll((links) => links.map((a) => a.getAttribute('href')))
  expect(hrefs).toEqual(CATALOGUE.map((entry) => demoPath(entry.slug)))
})

for (const def of CONCEPTS) {
  test(`${def.slug}: runs, and exposes only its own controls`, async ({ page }) => {
    const messages: string[] = []
    page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

    await page.goto(demoPath(def.slug))
    await expect(page.getByRole('heading', { name: def.title, level: 1 })).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'DEMOS' }),
    ).toHaveAttribute('aria-current', 'page')

    // One input per exposed control, and nothing else to fiddle with.
    await expect(page.locator('.sim-controls input, .sim-controls select')).toHaveCount(def.controls.length)
    await expect(page.locator('.sim-presets button')).toHaveCount(def.presets.length)
    await expect(page.getByTestId('held-constant')).toContainText('HELD CONSTANT')
    for (const id of def.readouts) await expect(page.getByTestId(`readout-${id}`)).toBeVisible()

    const clock = page.getByTestId('sim-clock')
    await expect(clock).not.toHaveText('T+0.3 S')
    expect(messages).toEqual([])
  })
}

test('retry-storms: the storm preset ends metastable, and no retries recovers', async ({ page }) => {
  await page.goto(demoPath('retry-storms'))
  await page.getByRole('button', { name: '10×' }).click()
  await expect(page.getByTestId('readout-health')).toContainText('METASTABLE', { timeout: 20_000 })

  await page.getByRole('button', { name: 'NO RETRIES' }).click()
  await expect(page.getByTestId('preset-description')).toContainText('retries off')
  await expect(page.getByTestId('readout-health')).toContainText('RECOVERING', { timeout: 20_000 })
  await expect(page.getByTestId('readout-health')).toContainText('HEALTHY', { timeout: 20_000 })
})

test('changing a control leaves the preset, and the held-constant line stays honest', async ({ page }) => {
  await page.goto(demoPath('queueing-knee'))
  await expect(page.getByRole('button', { name: '70% BUSY' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('SERVICE TIME SHAPE').selectOption('heavy')
  await expect(page.getByRole('button', { name: '70% BUSY' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('preset-description')).toContainText('Your own settings')
  await expect(page.getByTestId('held-constant')).toContainText('8 workers')
  await expect(page.getByTestId('held-constant')).toContainText('unbounded FIFO queue')
})
