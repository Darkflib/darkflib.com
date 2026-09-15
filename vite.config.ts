import { defineConfig } from 'vite'
import { readBuildInfo } from './build/buildInfo.ts'
import { serviceWorkerPlugin } from './build/serviceWorkerPlugin.ts'

const buildInfo = readBuildInfo()

export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [
    serviceWorkerPlugin({
      entry: 'src/sw/service-worker.ts',
      // Deliberately excludes the build time: an unchanged worker must produce identical bytes.
      build: `${buildInfo.sha}${buildInfo.dirty ? '-dirty' : ''}`,
    }),
  ],
})
