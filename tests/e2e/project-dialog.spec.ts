import { expect, test } from '../support/fixtures.ts'

test('project dialog opens from a card and closes via Escape, backdrop, and buttons, restoring focus', async ({
  page,
}) => {
  await page.goto('/')
  const card = page.getByRole('button', { name: 'Explore ECHO' })
  const dialog = page.getByRole('dialog', { name: 'ECHO' })

  // Keyboard path: macOS WebKit does not focus buttons on click, so focus restore is only meaningful from the keyboard.
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(card).toBeFocused()

  await card.click()
  await page.mouse.click(10, 10)
  await expect(dialog).toBeHidden()

  await card.click()
  await page.getByRole('button', { name: 'Close project details' }).click()
  await expect(dialog).toBeHidden()

  await card.click()
  await page.getByRole('button', { name: /RETURN TO PROJECTS/ }).click()
  await expect(dialog).toBeHidden()

  // Clicks inside the dialog must not dismiss it.
  await card.click()
  await dialog.getByRole('heading', { name: 'ECHO' }).click()
  await expect(dialog).toBeVisible()
})
