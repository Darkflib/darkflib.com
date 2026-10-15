import { defineConfig } from 'vite'
import { readBuildInfo } from './build/buildInfo.ts'
import { kevFeedPlugin } from './build/kevFeedPlugin.ts'
import { serviceWorkerPlugin } from './build/serviceWorkerPlugin.ts'
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
        demos: 'demos/index.html',
        ...Object.fromEntries(CATALOGUE.map(({ slug }) => [`demos-${slug}`, `demos/${slug}/index.html`])),
      },
    },
  },
  plugins: [
    // The worker's version is a hash of its own bundle, not buildInfo: an unchanged worker must deploy identical bytes.
    serviceWorkerPlugin({ entry: 'src/sw/service-worker.ts' }),
    // Development stand-in for the KEV snapshot Caddy serves off the darkflib-feeds volume in production.
    kevFeedPlugin(),
  ],
})
