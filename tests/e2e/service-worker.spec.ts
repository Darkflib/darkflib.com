import { checkForUpdate, expect, expectControlled, openEventLog, readEventLog, test } from '../support/fixtures.ts'

test.describe('service worker lifecycle', () => {
  test('first visit registers, activates, and takes control without a reload', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
    await expect(page.getByTestId('sw-registration')).toHaveText('REGISTERED')
    await expect(page.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED')
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')

    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'PAGE', event: 'register:complete' }),
          expect.objectContaining({ source: 'WORKER', event: 'install' }),
          expect.objectContaining({ source: 'WORKER', event: 'activate:complete' }),
          expect.objectContaining({ source: 'PAGE', event: 'controllerchange' }),
          expect.objectContaining({ source: 'PAGE', event: 'handshake' }),
        ]),
      )
  })

  test('reload is controlled from the start and does not reinstall', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)
    const build = await page.getByTestId('sw-build').textContent()

    await page.reload()
    await expectControlled(page)
    await expect(page.getByTestId('sw-build')).toHaveText(build ?? '')

    await openEventLog(page)
    await expect.poll(() => readEventLog(page)).toContainEqual(expect.objectContaining({ event: 'handshake' }))
    const events = (await readEventLog(page)).map((row) => `${row.source}:${row.event}`)
    expect(events).not.toContain('PAGE:controllerchange')
    expect(events).not.toContain('PAGE:updatefound')
    expect(events).not.toContain('WORKER:install')
  })

  test('an updated worker waits while the old one keeps control, then takes over', async ({
    page,
    context,
    server,
  }) => {
    await page.goto('/')
    await expectControlled(page)
    const original = (await page.getByTestId('sw-build').textContent()) ?? ''
    const updated = `${original}.test1`

    server.bumpServiceWorker()
    await checkForUpdate(page)

    await expect(page.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED · UPDATE WAITING')
    await expect(page.getByTestId('sw-build')).toHaveText(original)
    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toContainEqual(expect.objectContaining({ source: 'WORKER', event: 'install', detail: `build ${updated}` }))

    // The waiting worker activates once no page is using the old one.
    await page.close()
    const next = await context.newPage()
    await next.goto('/')
    await expect(next.getByTestId('sw-build')).toHaveText(updated)
    await expect(next.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED')
  })

  test('tabs share one registration: a second tab is controlled at once and both see the update', async ({
    page,
    context,
    server,
  }) => {
    await page.goto('/')
    await expectControlled(page)

    const second = await context.newPage()
    await second.goto('/')
    await expectControlled(second)
    await openEventLog(second)
    await expect.poll(() => readEventLog(second)).toContainEqual(expect.objectContaining({ event: 'handshake' }))
    expect((await readEventLog(second)).map((row) => row.event)).not.toContain('controllerchange')

    server.bumpServiceWorker()
    await checkForUpdate(page)

    for (const tab of [page, second]) {
      await expect(tab.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED · UPDATE WAITING')
    }
    await expect
      .poll(() => readEventLog(second))
      .toContainEqual(
        expect.objectContaining({ source: 'WORKER', event: 'install', detail: expect.stringMatching(/\.test1$/) }),
      )
  })

  test('?sw=off unregisters the worker and skips registration', async ({ page }) => {
    await page.goto('/')
    await expectControlled(page)

    await page.goto('/?sw=off')
    await expect(page.getByTestId('sw-status')).toHaveText('DISABLED (?sw=off)')
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length))
      .toBe(0)
  })
})
