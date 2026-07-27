import { expect, test } from "@playwright/test"

test("traps session switcher focus and restores the opener", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()

  const opener = page.getByRole("button", { name: "Toggle sidebar" })
  const dialog = page.getByRole("dialog", { name: "Switch session" })
  const input = page.getByRole("searchbox", { name: "Filter recent sessions" })

  await opener.focus()
  await page.keyboard.down("Control")
  await page.keyboard.press("Tab")
  await expect(dialog).toBeVisible()
  await page.keyboard.up("Control")
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await page.keyboard.down("Control")
  await page.keyboard.press("Tab")
  await expect(input).toBeFocused()
  await input.dispatchEvent("input")
  await page.keyboard.up("Control")

  await page.keyboard.press("Shift+Tab")
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Tab")
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await opener.focus()
  await expect(input).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
