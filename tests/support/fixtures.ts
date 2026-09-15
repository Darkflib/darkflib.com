import { existsSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import { startServer, type TestServer } from './server.ts'

export { expect }

export const test = base.extend<{ server: TestServer }, { workerServer: TestServer }>({
  workerServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixtures argument
    async ({}, use) => {
      if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
        throw new Error('dist/ is missing: run `npm run build` first (or use `npm run test:e2e`)')
      }
      const server = await startServer()
      await use(server)
      await server.close()
    },
    { scope: 'worker' },
  ],
  server: async ({ workerServer }, use) => {
    workerServer.reset()
    await use(workerServer)
  },
  baseURL: async ({ workerServer }, use) => {
    await use(workerServer.url)
  },
})

export interface LogRow {
  source: string
  event: string
  detail: string
}

export async function openEventLog(page: Page) {
  const toggle = page.getByRole('button', { name: /EVENT LOG/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

export async function readEventLog(page: Page): Promise<LogRow[]> {
  return page
    .getByTestId('sw-log')
    .locator('li:not(.empty-log)')
    .evaluateAll((items) =>
      items.map((item) => ({
        source: item.querySelector('span')?.textContent ?? '',
        event: item.querySelector('strong')?.textContent ?? '',
        detail: item.querySelector('em')?.textContent ?? '',
      })),
    )
}

export async function expectControlled(page: Page) {
  await expect(page.getByTestId('sw-status')).toHaveText('CONTROLLING THIS PAGE')
  await expect(page.getByTestId('sw-build')).toHaveText(/\+[0-9a-f]{8}/)
}

export async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('no registration')
    await registration.update()
  })
}
