import { expect, test } from '../support/fixtures.ts'

// The counts below are the committed fixture's, and stay true however old it gets: the test server moves the whole
// snapshot onto the moment it serves it (see build/kevFeedPlugin.ts, rebaseSnapshot).
const ENTRIES = 90
const PREVIEW = 8
const RANSOMWARE = 6

test.describe('KEV panel', () => {
  test('renders the snapshot this origin serves', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /KNOWN_EXPLOITED/ })).toBeVisible()
    expect(await page.getByTestId('kev-stats').locator('dd').allInnerTexts()).toEqual([
      String(PREVIEW),
      '43',
      String(ENTRIES),
      String(RANSOMWARE),
    ])
    await expect(page.getByTestId('kev-bars').locator('i')).toHaveCount(13)
    await expect(page.getByTestId('kev-sync')).toHaveText(/^SYNCED \d+M AGO$/)
    await expect(page.getByTestId('kev-entry')).toHaveCount(PREVIEW)

    // Newest first, and the newest entry's deadline is still ahead of it.
    const first = page.getByTestId('kev-entry').first()
    await expect(first.locator('.kev-cve')).toHaveText(/^CVE-\d{4}-\d{4,}$/)
    await expect(first.locator('.kev-due')).toHaveText(/^DUE \d{2}-\d{2}$/)
  })

  test('an entry opens to its description and its two sources', async ({ page }) => {
    await page.goto('/')
    const first = page.getByTestId('kev-entry').first()
    const cve = await first.locator('.kev-cve').innerText()

    await expect(first.locator('.kev-detail')).toBeHidden()
    await first.locator('summary').click()
    await expect(first.locator('.kev-detail')).toBeVisible()
    await expect(first.locator('.kev-detail p').first()).not.toBeEmpty()
    await expect(first.getByRole('link', { name: /NVD/ })).toHaveAttribute(
      'href',
      `https://nvd.nist.gov/vuln/detail/${cve}`,
    )
    // Only CISA's own catalogue is ever linked; kev-snapshot drops anything else.
    await expect(first.getByRole('link', { name: /CISA CATALOGUE/ })).toHaveAttribute(
      'href',
      new RegExp(`^https://www\\.cisa\\.gov/[^"]*${cve}$`),
    )
  })

  test('a deadline runs to the end of the day it names', async ({ page }) => {
    await page.goto('/')
    const snapshot = (await (await page.request.get('/feeds/kev.json')).json()) as {
      entries: { cve: string; due: string | null }[]
    }
    const entry = snapshot.entries.find((candidate) => candidate.due !== null)
    if (!entry?.due) throw new Error('the fixture has no entry with a deadline')
    const row = page.getByTestId('kev-entry').filter({ hasText: entry.cve })

    // The last minute of the deadline day: an agency patching today has met it.
    await page.clock.setFixedTime(new Date(`${entry.due}T23:59:00Z`))
    await page.reload()
    await expect(row.locator('.kev-due')).toHaveText(`DUE ${entry.due.slice(5)}`)

    // The following midnight, UTC.
    await page.clock.setFixedTime(Date.parse(`${entry.due}T00:00:00Z`) + 24 * 60 * 60 * 1000)
    await page.reload()
    await expect(row.locator('.kev-due')).toHaveText('PAST DUE')
  })

  test('shows the whole snapshot on request', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: `SHOW ALL ${ENTRIES}` }).click()
    await expect(page.getByTestId('kev-entry')).toHaveCount(ENTRIES)
    await expect(page.locator('.kev-ransomware')).toHaveCount(RANSOMWARE)

    await page.getByRole('button', { name: `SHOW LATEST ${PREVIEW}` }).click()
    await expect(page.getByTestId('kev-entry')).toHaveCount(PREVIEW)
  })

  test('opens sre-tab, the source, rather than sending a visitor to a dashboard they cannot use', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'VIA SRE-TAB' }).click()
    await expect(page.getByRole('dialog')).toContainText('SRE-TAB')
  })

  test('says when the hourly refresh has stopped happening', async ({ page, server }) => {
    server.setKevSnapshot('stale')
    await page.goto('/')
    await expect(page.getByTestId('kev-sync')).toHaveText('STALE · SYNCED 5H AGO')
  })

  test('no snapshot means no panel, and no console noise either', async ({ page, server }) => {
    server.setKevSnapshot('empty')
    const messages: string[] = []
    page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

    await page.goto('/')
    await expect(page.getByTestId('strip-build')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#kev')).toHaveCount(0)
    expect(messages).toEqual([])
  })

  test('hides itself rather than showing a snapshot it cannot trust', async ({ page, server }) => {
    for (const mode of ['ancient', 'malformed', 'error'] as const) {
      server.setKevSnapshot(mode)
      await page.goto('/')
      await expect(page.getByTestId('strip-build')).toBeVisible()
      await expect(page.locator('#kev'), `snapshot mode: ${mode}`).toHaveCount(0)
    }
  })
})
