import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

export interface Post {
  slug: string
  title: string
  subtitle: string
  /** YYYY-MM-DD. */
  date: string
}

interface PostsPluginOptions {
  /** RSS feed to read the newest posts from. */
  feed: string
  /** Only links under this prefix count as posts; the rest of the URL is the slug. */
  writingUrl: string
  /** How many posts to keep, newest first. */
  count: number
  /** Committed copy used when the feed cannot be read, so a build never fails on someone else's server. */
  fallback: string
}

const VIRTUAL_ID = 'virtual:posts'
const RESOLVED_ID = `\0${VIRTUAL_ID}`
const FETCH_TIMEOUT_MS = 10_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text: string): string {
  return text
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      return ENTITIES[entity.toLowerCase()] ?? match
    })
    .trim()
}

const tag = (item: string, name: string) => {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return match ? decode(match[1]) : null
}

/**
 * The newest posts in an RSS 2.0 document. Items without a title, a date, or a link under `writingUrl` are skipped
 * rather than trusted: the slug becomes a link on this site.
 */
export function parseFeed(xml: string, writingUrl: string, count: number): Post[] {
  const prefix = `${writingUrl.replace(/\/$/, '')}/`
  const posts: Post[] = []
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(item, 'title')
    const link = tag(item, 'link')
    const published = Date.parse(tag(item, 'pubDate') ?? '')
    if (!title || !link?.startsWith(prefix) || Number.isNaN(published)) continue
    const slug = link.slice(prefix.length).replace(/\/$/, '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue
    posts.push({
      slug,
      title,
      subtitle: tag(item, 'description') ?? '',
      date: new Date(published).toISOString().slice(0, 10),
    })
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, count)
}

/**
 * Provides `virtual:posts`: the newest posts from the writing feed, read once per build (or dev server start), so the
 * home page lists what was current when the site was built. If the feed cannot be read, or DARKFLIB_POSTS=fallback
 * is set (offline work), the committed fallback is used and the build says so.
 */
export function postsPlugin({ feed, writingUrl, count, fallback }: PostsPluginOptions): Plugin {
  let module: Promise<string> | null = null

  async function load(warn: (message: string) => void): Promise<string> {
    let posts: Post[] | null = null
    let source = feed
    if (process.env.DARKFLIB_POSTS !== 'fallback') {
      try {
        const response = await fetch(feed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        posts = parseFeed(await response.text(), writingUrl, count)
        if (!posts.length) throw new Error('no posts in the feed')
      } catch (error) {
        warn(`posts: could not read ${feed} (${error instanceof Error ? error.message : error}); using ${fallback}`)
        posts = null
      }
    }
    if (!posts) {
      posts = (JSON.parse(await readFile(fallback, 'utf8')) as Post[]).slice(0, count)
      source = fallback
    }
    return `export const posts = ${JSON.stringify(posts)}\nexport const postsSource = ${JSON.stringify(source)}\n`
  }

  return {
    name: 'darkflib:posts',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null
      module ??= load((message) => this.warn(message))
      return module
    },
  }
}
