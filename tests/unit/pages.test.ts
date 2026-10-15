import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { sitePages, sitePaths } from '../../scripts/pages.ts'

it('the committed pages match what scripts/pages.ts generates (run `npm run pages`)', async () => {
  for (const [file, html] of sitePages()) {
    const committed = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.equal(committed, html, `${file} is out of date`)
  }
})

it('every listed page is in the sitemap, and no unlisted one is', async () => {
  const sitemap = await readFile(new URL('../../public/sitemap.xml', import.meta.url), 'utf8')
  for (const { path, listed } of sitePaths()) {
    const present = sitemap.includes(`<loc>https://darkflib.com${path}</loc>`)
    assert.equal(
      present,
      listed,
      listed ? `${path} is missing from the sitemap` : `${path} is unlisted but in the sitemap`,
    )
  }
})

it('unlisted pages ask not to be indexed', () => {
  const pages = sitePages()
  for (const { file, listed } of sitePaths()) {
    assert.equal(pages.get(file)?.includes('content="noindex, nofollow"'), !listed, file)
  }
})

it('every demo is in exactly one index group', async () => {
  const { CATALOGUE, CIRCUIT_BREAKER, DEMO_GROUPS } = await import('../../src/demos/catalogue.ts')
  const { BURN_RATE } = await import('../../src/demos/burnrate/demo.ts')
  const { CONCEPTS } = await import('../../src/demos/concepts/index.ts')
  const grouped = DEMO_GROUPS.flatMap((group) => group.demos.map((entry) => entry.slug))
  assert.equal(new Set(grouped).size, grouped.length, 'a demo is in two groups')
  assert.deepEqual(
    [...grouped].sort(),
    [...CONCEPTS.map((concept) => concept.slug), BURN_RATE.slug, CIRCUIT_BREAKER.slug].sort(),
    'a demo is missing from the groups',
  )
  assert.equal(CATALOGUE.length, grouped.length)
})
