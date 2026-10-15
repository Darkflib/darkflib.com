import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { parseFeed } from '../../build/postsPlugin.ts'

const WRITING = 'https://mikepreston.org/writing'

const item = (fields: Record<string, string>) =>
  `<item>${Object.entries(fields)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('')}</item>`

it('reads the newest posts from RSS, decoding entities and CDATA', () => {
  const xml = `<rss><channel>
    ${item({ title: 'Older', link: `${WRITING}/older`, pubDate: 'Mon, 05 Oct 2026 00:00:00 +0000', description: 'a' })}
    ${item({ title: 'Ops &amp; &#8220;Tools&#8221;', link: `${WRITING}/newer`, pubDate: 'Fri, 09 Oct 2026 00:00:00 +0000', description: '<![CDATA[b <i>c</i>]]>' })}
  </channel></rss>`
  assert.deepEqual(parseFeed(xml, WRITING, 6), [
    { slug: 'newer', title: 'Ops & “Tools”', subtitle: 'b <i>c</i>', date: '2026-10-09' },
    { slug: 'older', title: 'Older', subtitle: 'a', date: '2026-10-05' },
  ])
})

it('keeps only posts under the writing URL with a usable slug and date, up to the count', () => {
  const ok = (n: number) =>
    item({ title: `Post ${n}`, link: `${WRITING}/post-${n}`, pubDate: `Fri, 0${n} Oct 2026 00:00:00 +0000` })
  const xml = [
    ok(1),
    ok(2),
    ok(3),
    item({ title: 'Elsewhere', link: 'https://example.com/writing/x', pubDate: 'Fri, 09 Oct 2026 00:00:00 +0000' }),
    item({ title: 'Nested', link: `${WRITING}/a/b`, pubDate: 'Fri, 09 Oct 2026 00:00:00 +0000' }),
    item({ title: 'Undated', link: `${WRITING}/undated` }),
  ].join('')
  assert.deepEqual(
    parseFeed(xml, WRITING, 2).map((post) => post.slug),
    ['post-3', 'post-2'],
  )
})

it('the committed fallback is well formed', async () => {
  const fallback = JSON.parse(await readFile(new URL('../../src/posts.fallback.json', import.meta.url), 'utf8'))
  assert.ok(Array.isArray(fallback) && fallback.length > 0)
  for (const post of fallback) {
    assert.match(post.slug, /^[a-z0-9][a-z0-9-]*$/)
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(post.title)
  }
})
