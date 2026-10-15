/** Injected by vite.config.ts at build (or dev server start) time. */
declare const __BUILD_INFO__: {
  sha: string
  dirty: boolean
  time: string
}

/** The newest posts from mikepreston.org's feed, read at build time by build/postsPlugin.ts. */
declare module 'virtual:posts' {
  export const posts: readonly { slug: string; title: string; subtitle: string; date: string }[]
  /** The feed URL, or the fallback file's path when the feed could not be read. */
  export const postsSource: string
}
