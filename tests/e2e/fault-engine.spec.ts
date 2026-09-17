import {
  expect,
  expectControlled,
  FIREFOX_PASSIVE_NAVIGATION,
  openEventLog,
  pageFetch,
  readEventLog,
  setFaults,
  test,
} from '../support/fixtures.ts'

test.describe('fault engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
  })

  test('the worker reports fault-injection', async ({ page }) => {
    await expect(page.getByTestId('sw-version')).toHaveAttribute('title', /fault-injection v1/)
  })

  test('offline: a network error, and nothing reaches the origin', async ({ page, server }) => {
    const primary = server.labOrigins['api-primary']
    const ack = await setFaults(page, [{ origin: primary, mode: 'offline', probability: 1 }])
    expect(ack).toEqual({ rules: [{ origin: primary, mode: 'offline', probability: 1 }], rejected: [] })

    const result = await pageFetch(page, `${primary}/v1/status.json?case=offline`)
    expect(result).toMatchObject({ ok: false, error: 'TypeError' })
    expect(server.labRequests('api-primary', 'case=offline')).toBe(0)

    // Other origins are untouched.
    const secondary = await pageFetch(page, `${server.labOrigins['api-secondary']}/v1/status.json`)
    expect(secondary).toMatchObject({ ok: true, status: 200 })
    expect(secondary.ok && JSON.parse(secondary.body).origin).toBe('api-secondary')

    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toContainEqual(
        expect.objectContaining({
          tag: 'fault',
          event: 'fault:offline',
          detail: expect.stringMatching(
            /^GET .*\/v1\/status\.json\?case=offline · simulated network failure; no request sent$/,
          ),
        }),
      )
  })

  test('status: a synthetic 503 with Retry-After, and nothing reaches the origin', async ({ page, server }) => {
    const primary = server.labOrigins['api-primary']
    await setFaults(page, [{ origin: primary, mode: 'status', status: 503, retryAfterSeconds: 7, probability: 1 }])
    const result = await pageFetch(page, `${primary}/v1/status.json?case=status`)
    expect(result).toMatchObject({ ok: true, status: 503, retryAfter: '7', simulated: 'status' })
    expect(server.labRequests('api-primary', 'case=status')).toBe(0)
  })

  test('latency: the real response, after the delay', async ({ page, server }) => {
    const primary = server.labOrigins['api-primary']
    await setFaults(page, [{ origin: primary, mode: 'latency', latencyMs: 600, probability: 1 }])
    const result = await pageFetch(page, `${primary}/v1/status.json?case=latency`)
    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(580)
    expect(result.ok && JSON.parse(result.body).origin).toBe('api-primary')
    expect(server.labRequests('api-primary', 'case=latency')).toBe(1)
  })

  test('latency: a client timeout fails the request, as a slow origin would', async ({ page, server }) => {
    const primary = server.labOrigins['api-primary']
    await setFaults(page, [{ origin: primary, mode: 'latency', latencyMs: 1500, probability: 1 }])
    const result = await pageFetch(page, `${primary}/v1/status.json?case=timeout`, { timeoutMs: 300 })
    // WebKit reports AbortSignal.timeout() as AbortError; Chromium and Firefox as TimeoutError.
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^(TimeoutError|AbortError)$/) })
    // Browsers do not propagate the page's abort into the worker, so the delayed request still goes out, once.
    await expect.poll(() => server.labRequests('api-primary', 'case=timeout'), { timeout: 4000 }).toBe(1)
  })

  test('probability 0 never applies; an empty rule set clears the faults', async ({ page, server }) => {
    const primary = server.labOrigins['api-primary']
    await setFaults(page, [{ origin: primary, mode: 'offline', probability: 0 }])
    expect(await pageFetch(page, `${primary}/v1/status.json`)).toMatchObject({ ok: true, status: 200 })

    await setFaults(page, [{ origin: primary, mode: 'offline', probability: 1 }])
    expect(await pageFetch(page, `${primary}/v1/status.json`)).toMatchObject({ ok: false })
    expect(await setFaults(page, [])).toEqual({ rules: [], rejected: [] })
    expect(await pageFetch(page, `${primary}/v1/status.json`)).toMatchObject({ ok: true, status: 200 })
  })

  test("rejects invalid rules and the site's own origin, which stays reachable", async ({ page, server }) => {
    const ack = await setFaults(page, [
      { origin: server.url, mode: 'offline', probability: 1 },
      { origin: server.labOrigins.media, mode: 'offline', probability: 2 },
      { origin: server.labOrigins['api-primary'], mode: 'status', status: 500, probability: 1 },
      { origin: server.labOrigins['api-secondary'], mode: 'offline', probability: 1 },
      { origin: server.labOrigins['api-secondary'], mode: 'latency', latencyMs: 10, probability: 1 },
    ])
    expect(ack.rules).toEqual([{ origin: server.labOrigins['api-secondary'], mode: 'offline', probability: 1 }])
    expect(ack.rejected).toEqual([
      { origin: server.url, reason: "the site's own origin is never faulted" },
      { origin: server.labOrigins.media, reason: 'invalid rule' },
      { origin: server.labOrigins['api-primary'], reason: 'invalid rule' },
      { origin: server.labOrigins['api-secondary'], reason: 'duplicate origin' },
    ])
    expect(await pageFetch(page, '/index.html')).toMatchObject({ ok: true, status: 200 })
  })

  test('rules apply only to the tab that set them', async ({ page, context, server, browserName }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)
    const primary = server.labOrigins['api-primary']
    await setFaults(page, [{ origin: primary, mode: 'offline', probability: 1 }])

    const other = await context.newPage()
    await other.goto('/')
    await expectControlled(other)
    expect(await pageFetch(other, `${primary}/v1/status.json`)).toMatchObject({ ok: true, status: 200 })
    expect(await pageFetch(page, `${primary}/v1/status.json`)).toMatchObject({ ok: false })
  })
})
