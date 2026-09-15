import { expect, test } from '../support/fixtures.ts'

test('the hero image is downloaded once, as AVIF, and matches the preload', async ({ page }) => {
  const heroRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/images/hero-city-')) heroRequests.push(url.pathname)
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const hero = page.locator('.hero-art img')
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  const current = await hero.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname)

  expect(current).toMatch(/^\/images\/hero-city-\d+\.avif$/)
  // One request: the preload in index.html and the <picture> agree on the file, and no fallback format is fetched.
  expect(heroRequests).toEqual([current])
})

test('project images load one format each', async ({ page }) => {
  const projectRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/images/projects/')) projectRequests.push(url.pathname)
  })

  await page.goto('/')
  await page.getByRole('heading', { name: 'FEATURED_PROJECTS' }).scrollIntoViewIfNeeded()
  await page.waitForLoadState('networkidle')

  const slugs = projectRequests.map((path) => path.replace(/-\d+\.(avif|webp)$/, ''))
  expect(new Set(slugs).size).toBe(slugs.length)
  expect(projectRequests.every((path) => path.endsWith('.avif'))).toBe(true)
})
