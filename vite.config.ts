import { defineConfig } from 'vite'
import { readBuildInfo } from './build/buildInfo.ts'
import { kevFeedPlugin } from './build/kevFeedPlugin.ts'
import { postsPlugin } from './build/postsPlugin.ts'
import { serviceWorkerPlugin } from './build/serviceWorkerPlugin.ts'
import { LATEST_POSTS, WRITING_FEED, WRITING_URL } from './src/content.ts'
import { CATALOGUE } from './src/demos/catalogue.ts'

const buildInfo = readBuildInfo()

export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  // One HTML document per top-level page; the service worker's scope covers them all.
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        projects: 'projects/index.html',
        demos: 'demos/index.html',
        ...Object.fromEntries(CATALOGUE.map(({ slug }) => [`demos-${slug}`, `demos/${slug}/index.html`])),
        login: 'login/index.html',
        'login-enrol': 'login/enrol/index.html',
        'login-step-up': 'login/step-up/index.html',
        'login-denied': 'login/denied/index.html',
        tools: 'tools/index.html',
        'tools-debug': 'tools/debug/index.html',
        'tools-users': 'tools/users/index.html',
        'tools-domain': 'tools/domain/index.html',
      },
    },
  },
  // Production proxies /auth/* to wwff-auth through Caddy. Locally, AUTH_ORIGIN=http://localhost:8000 points the dev
  // server at a running copy; without it /auth answers 404 and the login pages behave as signed out.
  server: process.env.AUTH_ORIGIN ? { proxy: { '/auth': process.env.AUTH_ORIGIN } } : undefined,
  plugins: [
    // The worker's version is a hash of its own bundle, not buildInfo: an unchanged worker must deploy identical bytes.
    serviceWorkerPlugin({ entry: 'src/sw/service-worker.ts' }),
    // Development stand-in for the KEV snapshot Caddy serves off the darkflib-feeds volume in production.
    kevFeedPlugin(),
    // The home page's posts, newest first, as of this build.
    postsPlugin({
      feed: WRITING_FEED,
      writingUrl: WRITING_URL,
      count: LATEST_POSTS,
      fallback: 'src/posts.fallback.json',
    }),
  ],
})
