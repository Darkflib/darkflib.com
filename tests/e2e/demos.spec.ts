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

test('breaking-the-loop: presets set the toggles, and a toggle leaves the preset', async ({ page }) => {
  await page.goto(demoPath('breaking-the-loop'))
  const skip = page.getByLabel('SKIP EXPIRED WORK')
  const shed = page.getByLabel('SHED BY QUEUE AGE')
  const lifo = page.getByLabel('NEWEST FIRST (LIFO)')
  for (const toggle of [skip, shed, lifo]) await expect(toggle).not.toBeChecked()

  await page.getByRole('button', { name: 'NEWEST FIRST + SKIP' }).click()
  await expect(skip).toBeChecked()
  await expect(lifo).toBeChecked()
  await expect(shed).not.toBeChecked()
  await expect(page.getByTestId('held-constant')).toContainText('3 retries')

  await shed.check()
  await expect(page.getByRole('button', { name: 'NEWEST FIRST + SKIP' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('preset-description')).toContainText('Your own settings')

  await page.getByRole('button', { name: 'SHED BY AGE' }).click()
  await expect(shed).toBeChecked()
  await page.getByRole('button', { name: '10×' }).click()
  await expect(page.getByTestId('readout-health')).toContainText('HEALTHY', { timeout: 20_000 })
})

test('overload: blocking the caller piles the backlog up upstream', async ({ page }) => {
  await page.goto(demoPath('overload'))
  await page.getByRole('button', { name: 'BLOCK THE CALLER' }).click()
  await expect(page.getByLabel('WHEN THE QUEUE IS FULL')).toHaveValue('block')
  await page.getByRole('button', { name: '10×' }).click()
  await expect(page.getByTestId('readout-blocked')).toContainText('CALLERS WAITING TO ENQUEUE')
  await expect(page.getByTestId('readout-health')).toContainText('COLLAPSED', { timeout: 20_000 })
  await expect(page.getByTestId('readout-queueDepth')).toContainText('50')
})

test('sandbox: only the autoscaler is held constant, and both disturbances are buttons', async ({ page }) => {
  await page.goto(demoPath('sandbox'))
  await expect(page.getByTestId('held-constant')).toHaveText('HELD CONSTANT a fixed pool: no autoscaler')
  await expect(page.getByRole('button', { name: 'INJECT SPIKE' })).toBeVisible()
  await page.getByRole('button', { name: 'SLOW DEPENDENCY' }).click()
  await expect(page.locator('.sim-presets button[aria-pressed="true"]')).toHaveText('STEADY')
})

test('autoscaler: the stale preset swings the pool, and a cooldown slows the scaling down', async ({ page }) => {
  await page.goto(demoPath('autoscaler'))
  await page.getByRole('button', { name: '10×' }).click()
  await expect(page.getByTestId('readout-pool')).toContainText('NEEDS 10', { timeout: 10_000 })
  await expect(page.getByTestId('readout-pool')).toHaveText(/WORKERS\s*(3[0-2]|2)\b/, { timeout: 20_000 })

  await page.getByRole('button', { name: '12 S COOLDOWN' }).click()
  await expect(page.getByLabel('COOLDOWN')).toHaveValue('12')
  await expect(page.getByTestId('readout-scaling')).toContainText('LAST', { timeout: 10_000 })
  await expect(page.getByTestId('held-constant')).toContainText('2 to 32 workers')
})

test('the index groups related demos, numbered across the whole index', async ({ page }) => {
  const { DEMO_GROUPS } = await import('../../src/demos/catalogue.ts')
  await page.goto('/demos/')
  for (const group of DEMO_GROUPS) {
    const section = page.getByRole('region', { name: group.title })
    await expect(section.getByRole('heading', { level: 2 })).toContainText(group.title)
    const hrefs = await section
      .locator('.demos-card a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')))
    expect(hrefs).toEqual(group.demos.map((entry) => `/demos/${entry.slug}/`))
    // The list's own numbering agrees with the number printed on the first card.
    const first = section.locator('.demos-card').first()
    const printed = Number(await first.locator('.demos-card-meta span').first().textContent())
    await expect(section.locator('ol')).toHaveAttribute('start', String(printed))
  }
})

test('slo-burn-rate: incidents set the verdicts, and drawing one makes it your own', async ({ page }) => {
  const messages: string[] = []
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

  await page.goto(demoPath('slo-burn-rate'))
  await expect(page.getByRole('heading', { name: 'SLO BURN RATE', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'DEMOS' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('verdict-threshold')).toContainText('PAGED FOR NOTHING')
  await expect(page.getByTestId('verdict-multi')).toContainText('RIGHTLY QUIET')

  await page.getByRole('button', { name: 'SLOW LEAK' }).click()
  await expect(page.getByTestId('verdict-threshold')).toContainText('MISSED IT')
  await expect(page.getByTestId('verdict-single')).toContainText('MISSED IT')
  await expect(page.getByTestId('verdict-multi')).toContainText('CAUGHT IT')

  // A looser SLO, and the leak is no longer worth a page.
  await page.getByLabel('SLO TARGET').selectOption('0.99')
  await expect(page.getByTestId('verdict-multi')).toContainText('RIGHTLY QUIET')
  await page.getByLabel('SLO TARGET').selectOption('0.999')

  // The replay's cursor drives the at-the-cursor table.
  await page.getByLabel('TIME').fill('779')
  await expect(page.getByTestId('burn-clock')).toHaveText('13:00')
  await expect(page.getByTestId('burn-why')).toContainText('6 H')

  // Drag a plateau across the error rate, high enough for every rule to page.
  await page.getByRole('button', { name: 'DRAW YOUR OWN' }).click()
  await expect(page.getByTestId('verdict-multi')).toContainText('RIGHTLY QUIET')
  const canvas = page.getByRole('img', { name: /error rate/ })
  // Mouse coordinates are the viewport's: bring the plot, at the top of the canvas, fully into view first. Instantly,
  // as the site scrolls smoothly, and a box measured mid-scroll puts the stroke somewhere else.
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  expect(box.y).toBeGreaterThanOrEqual(0)
  await page.mouse.move(box.x + box.width * 0.3, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + 30, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.sim-presets button[aria-pressed="true"]')).toHaveCount(0)
  await expect(page.getByTestId('preset-description')).toContainText('Your own drawing')
  for (const rule of ['threshold', 'single', 'multi']) {
    await expect(page.getByTestId(`verdict-${rule}`)).toContainText('CAUGHT IT')
  }
  expect(messages).toEqual([])
})
