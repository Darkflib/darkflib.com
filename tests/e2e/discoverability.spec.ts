import { expect, test } from '../support/fixtures.ts'

const ORIGIN = 'https://darkflib.com'

test('robots.txt allows crawling and points at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt')
  expect(response.ok()).toBe(true)
  const body = await response.text()
  expect(body).toContain('User-agent: *')
  expect(body).not.toMatch(/^Disallow: \/$/m)
  expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
})

test('the sitemap lists the canonical home page', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.ok()).toBe(true)
  expect(await response.text()).toContain(`<loc>${ORIGIN}/</loc>`)
})

test('the document carries canonical, link-preview, and structured metadata', async ({ page, request }) => {
  await page.goto('/')

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/`)
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${ORIGIN}/`)
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')

  // The preview card is referenced absolutely; it must exist under the same path in this build.
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content')
  expect(ogImage?.startsWith(`${ORIGIN}/`)).toBe(true)
  const card = await request.get(new URL(ogImage ?? '').pathname)
  expect(card.ok()).toBe(true)
  expect(card.headers()['content-type']).toBe('image/jpeg')

  const icon = await page.locator('link[rel="icon"]').getAttribute('href')
  expect((await request.get(icon ?? '')).ok()).toBe(true)

  const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '')['@graph']
  expect(graph.map((node: { '@type': string }) => node['@type'])).toEqual(['WebSite', 'Person'])
})
