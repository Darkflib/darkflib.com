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
  // auto: every test starts from a clean server, including tests that never ask for `server`. Otherwise a worker
  // override or version bump set by one test leaks into the next test on the same Playwright worker.
  server: [
    async ({ workerServer }, use) => {
      workerServer.reset()
      await use(workerServer)
    },
    { auto: true },
  ],
  baseURL: async ({ workerServer }, use) => {
    await use(workerServer.url)
  },
  // The site scrolls smoothly (`scroll-behavior: smooth` on :root), and WebKit animates Playwright's own scroll into
  // view with it: Playwright measures an element's box, then clicks there while the page is still gliding, and the
  // click lands beside the element. Every scroll is instant under test, as Playwright assumes, in every page.
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      const instant = () => document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important')
      if (document.documentElement) instant()
      else document.addEventListener('readystatechange', instant, { once: true })
    })
    await use(context)
  },
})

export interface LogRow {
  source: string
  tag: string
  event: string
  detail: string
}

/**
 * Playwright's patched Firefox leaves a page uncontrolled when a navigation goes through a service worker whose fetch
 * listener does not call respondWith. Real Firefox (Developer Edition 156) keeps it controlled, as the spec requires:
 * checked with puppeteer-core against this test server, including the navigation's observed-request row. Tests that
 * need a worker-routed navigation to leave the page controlled skip that project with this reason.
 */
export const FIREFOX_PASSIVE_NAVIGATION =
  "Playwright's Firefox leaves pages uncontrolled after a navigation the worker observes without responding; real Firefox does not"

/** The page whose event log the worker tests read: the log is always open there. */
export const LOG_PAGE = '/demos/circuit-breaker/'

/** The event log, on LOG_PAGE. */
export async function openEventLog(page: Page) {
  await expect(page.getByTestId('sw-log')).toBeVisible()
}

/** On the circuit breaker page, where the lab lives. It starts open there; this also reopens it after a test collapses it. */
export async function openFaultLab(page: Page) {
  const toggle = page.locator('#fault-lab').getByRole('button', { name: /^(EXPAND|COLLAPSE)$/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

export async function readEventLog(page: Page): Promise<LogRow[]> {
  return page
    .getByTestId('sw-log')
    .locator('li:not(.empty-log)')
    .evaluateAll((items) =>
      items.map((item) => ({
        source: item.querySelector('span')?.textContent ?? '',
        tag: (item as HTMLElement).dataset.tag ?? '',
        event: item.querySelector('strong')?.textContent ?? '',
        detail: item.querySelector('em')?.textContent ?? '',
      })),
    )
}

export async function expectControlled(page: Page) {
  await expect(page.getByTestId('sw-status')).toHaveText('CONTROLLING THIS PAGE')
  await expect(page.getByTestId('sw-version')).toHaveText(/^sw-[0-9a-f]{8}/)
}

export async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('no registration')
    await registration.update()
  })
}

export interface FaultAck {
  rules: { origin: string; mode: string }[]
  rejected: { origin: string; reason: string }[]
}

/** Send `fault:set` to the controlling worker and return its acknowledgement (the rules it actually holds). */
export async function setFaults(page: Page, rules: unknown[]): Promise<FaultAck> {
  return page.evaluate(
    (candidates) =>
      new Promise<FaultAck>((resolve, reject) => {
        const controller = navigator.serviceWorker.controller
        if (!controller) {
          reject(new Error('page is not controlled'))
          return
        }
        const channel = new MessageChannel()
        const timer = setTimeout(() => reject(new Error('no fault:ack within 3 s')), 3000)
        channel.port1.onmessage = (event) => {
          clearTimeout(timer)
          const { rules, rejected } = event.data as FaultAck
          resolve({ rules, rejected })
        }
        controller.postMessage({ type: 'fault:set', rules: candidates }, [channel.port2])
      }),
    rules,
  )
}

/** fetch() a URL from the page and report what came back, including a network error. */
export async function pageFetch(page: Page, url: string, options: { timeoutMs?: number } = {}) {
  return page.evaluate(
    async ({ target, timeoutMs }) => {
      const started = performance.now()
      try {
        const response = await fetch(target, {
          cache: 'no-store',
          signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        })
        const body = await response.text()
        return {
          ok: true as const,
          status: response.status,
          retryAfter: response.headers.get('retry-after'),
          simulated: response.headers.get('x-simulated-fault'),
          body,
          elapsedMs: performance.now() - started,
        }
      } catch (error) {
        return { ok: false as const, error: (error as Error).name, elapsedMs: performance.now() - started }
      }
    },
    { target: url, timeoutMs: options.timeoutMs },
  )
}
