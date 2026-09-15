import { defineConfig, devices } from '@playwright/test'

// Browser check against a running production image (see deploy/scripts/smoke.sh with KEEP=1). Chromium maps
// darkflib.com to that container, so requests carry the real Host header and Caddy routes them as it will on ny03,
// and treats the plain-HTTP origin as secure so the service worker can register.
const upstream = process.env.SMOKE_UPSTREAM ?? '127.0.0.1:18080'

export default defineConfig({
  testDir: 'tests/deploy',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://darkflib.com',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium rather than the headless shell, which ignores --unsafely-treat-insecure-origin-as-secure.
        channel: 'chromium',
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP darkflib.com ${upstream}`,
            '--unsafely-treat-insecure-origin-as-secure=http://darkflib.com',
          ],
        },
      },
    },
  ],
})
