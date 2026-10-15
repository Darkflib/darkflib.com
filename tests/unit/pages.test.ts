import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { demoPages } from '../../scripts/demo-pages.ts'

it('the committed demo pages match what scripts/demo-pages.ts generates (run `npm run pages`)', async () => {
  for (const [file, html] of demoPages()) {
    const committed = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.equal(committed, html, `${file} is out of date`)
  }
})

it('every demo page is in the sitemap', async () => {
  const sitemap = await readFile(new URL('../../public/sitemap.xml', import.meta.url), 'utf8')
  for (const file of demoPages().keys()) {
    const path = `/${file.replace(/index\.html$/, '')}`
    assert.ok(sitemap.includes(`<loc>https://darkflib.com${path}</loc>`), `${path} is missing from the sitemap`)
  }
})
