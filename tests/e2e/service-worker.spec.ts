import {
  checkForUpdate,
  expect,
  expectControlled,
  FIREFOX_PASSIVE_NAVIGATION,
  openEventLog,
  readEventLog,
  test,
} from '../support/fixtures.ts'

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

  test('reload is controlled from the start and does not reinstall', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)

    await page.goto('/')
    await expectControlled(page)
    const build = await page.getByTestId('sw-version').textContent()

    await page.reload()
    await expectControlled(page)
    await expect(page.getByTestId('sw-version')).toHaveText(build ?? '')

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
    browserName,
  }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)

    await page.goto('/')
    await expectControlled(page)
    const original = (await page.getByTestId('sw-version').textContent()) ?? ''
    const updated = `${original}.test1`

    server.bumpServiceWorker()
    await checkForUpdate(page)

    await expect(page.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED · UPDATE WAITING')
    await expect(page.getByTestId('sw-version')).toHaveText(original)
    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toContainEqual(expect.objectContaining({ source: 'WORKER', event: 'install', detail: `build ${updated}` }))

    // The waiting worker activates once no page is using the old one.
    await page.close()
    const next = await context.newPage()
    await next.goto('/')
    await expect(next.getByTestId('sw-version')).toHaveText(updated)
    // The new worker controls the page either way (its build answered the handshake). In Playwright's WebKit, a
    // navigation that arrives while the activate event's waitUntil is still pending leaves activation unfinished for
    // good: the worker serves the page and answers messages, but reports 'activating' and never sends activate:complete.
    // Reproduced locally with a 300 ms activate; CI's slower runners hit it with ours. Chromium holds the navigation.
    await expect(next.getByTestId('sw-lifecycle')).toHaveText(
      browserName === 'webkit' ? /^ACTIVAT(ED|ING)$/ : 'ACTIVATED',
    )
  })

  test('UPGRADE activates a waiting update without closing the tab', async ({ page, server }) => {
    await page.goto('/')
    await expectControlled(page)
    const original = (await page.getByTestId('sw-version').textContent()) ?? ''
    const updated = `${original}.test1`

    // No update waiting, no button.
    const upgrade = page.getByRole('button', { name: 'UPGRADE' })
    await expect(upgrade).toHaveCount(0)

    server.bumpServiceWorker()
    await checkForUpdate(page)
    await expect(page.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED · UPDATE WAITING')
    // The page asks the waiting worker what it is before offering to activate it.
    await expect(page.getByTestId('sw-waiting-version')).toHaveText(updated)
    await expect(upgrade).toBeEnabled()
    await expect(page.getByTestId('sw-version')).toHaveText(original)

    await upgrade.click()

    await expect(page.getByTestId('sw-version')).toHaveText(updated)
    await expect(page.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED')
    await expect(page.getByTestId('sw-waiting-version')).toHaveCount(0)
    await openEventLog(page)
    await expect
      .poll(() => readEventLog(page))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'PAGE', event: 'upgrade:requested' }),
          expect.objectContaining({
            source: 'WORKER',
            event: 'skip-waiting',
            detail: expect.stringContaining(updated),
          }),
          expect.objectContaining({ source: 'PAGE', event: 'controllerchange' }),
        ]),
      )
    expect((await readEventLog(page)).map((row) => row.event)).not.toContain('upgrade:timeout')
  })

  test('tabs share one registration: a second tab is controlled at once, both see the update, and both upgrade', async ({
    page,
    context,
    server,
    browserName,
  }) => {
    test.skip(browserName === 'firefox', FIREFOX_PASSIVE_NAVIGATION)

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

    // UPGRADE in one tab moves every tab to the new worker.
    await second.getByRole('button', { name: 'UPGRADE' }).click()
    for (const tab of [page, second]) {
      await expect(tab.getByTestId('sw-version')).toHaveText(/\.test1$/)
      await expect(tab.getByTestId('sw-lifecycle')).toHaveText('ACTIVATED')
    }
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
