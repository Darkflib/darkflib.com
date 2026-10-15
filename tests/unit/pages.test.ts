import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { sitePages } from '../../scripts/pages.ts'

it('the committed pages match what scripts/pages.ts generates (run `npm run pages`)', async () => {
  for (const [file, html] of sitePages()) {
    const committed = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.equal(committed, html, `${file} is out of date`)
  }
})

it('every generated page is in the sitemap', async () => {
  const sitemap = await readFile(new URL('../../public/sitemap.xml', import.meta.url), 'utf8')
  for (const file of sitePages().keys()) {
    const path = `/${file.replace(/index\.html$/, '')}`
    assert.ok(sitemap.includes(`<loc>https://darkflib.com${path}</loc>`), `${path} is missing from the sitemap`)
  }
})

it('every demo is in exactly one index group', async () => {
  const { CATALOGUE, CIRCUIT_BREAKER, DEMO_GROUPS } = await import('../../src/demos/catalogue.ts')
  const { CONCEPTS } = await import('../../src/demos/concepts/index.ts')
  const grouped = DEMO_GROUPS.flatMap((group) => group.demos.map((entry) => entry.slug))
  assert.equal(new Set(grouped).size, grouped.length, 'a demo is in two groups')
  assert.deepEqual(
    [...grouped].sort(),
    [...CONCEPTS.map((concept) => concept.slug), CIRCUIT_BREAKER.slug].sort(),
    'a demo is missing from the groups',
  )
  assert.equal(CATALOGUE.length, grouped.length)
})
