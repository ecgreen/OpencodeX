import { expect, test, type Page } from "@playwright/test"

const viewports = [
  { width: 980, height: 680 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
] as const

test("renders the canonical light and dark systems without overflow", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const theme of ["dark", "light"] as const) {
      await page.goto(`/?design-lab&theme=${theme}`)
      await expect(page.getByRole("heading", { name: "GUI design system lab" })).toBeVisible()
      await expect(page.getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("Loading workspace tools", { exact: true })).toBeVisible()
      expect(await themeMetrics(page)).toEqual({
        theme,
        canvas: theme === "dark" ? "#0b0d10" : "#f6f7f8",
        text: theme === "dark" ? "#f3f5f7" : "#171a1f",
        overflow: false,
      })
    }
  }
})

test("switches themes through the shared button primitive", async ({ page }) => {
  await page.goto("/?design-lab&theme=dark")
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(await themeMetrics(page)).toEqual({ theme: "light", canvas: "#f6f7f8", text: "#171a1f", overflow: false })
})

async function themeMetrics(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      theme: document.documentElement.dataset.theme,
      canvas: root.getPropertyValue("--theme-canvas").trim(),
      text: root.getPropertyValue("--theme-text").trim(),
      overflow: document.body.scrollWidth > innerWidth,
    }
  })
}
