import { expect, test, type Page } from "@playwright/test"

const viewports = [
  { width: 980, height: 680 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
] as const

/** WCAG AA for normal text. The palette may be retuned; this floor may not drop. */
const MIN_TEXT_CONTRAST = 4.5

test("renders the canonical light and dark systems without overflow", async ({ page }) => {
  const canvases = new Set<string>()
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const theme of ["dark", "light"] as const) {
      await page.goto(`/?design-lab&theme=${theme}`)
      await expect(page.getByRole("heading", { name: "GUI design system lab" })).toBeVisible()
      await expect(page.getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("Loading workspace tools", { exact: true })).toBeVisible()
      const metrics = await themeMetrics(page)
      expect(metrics.theme).toBe(theme)
      expect(metrics.canvas).toMatch(/^#[0-9a-f]{6}$/i)
      expect(metrics.text).toMatch(/^#[0-9a-f]{6}$/i)
      expect(metrics.overflow).toBe(false)
      // Body text has to stay readable on the canvas in both themes.
      expect(metrics.textContrast).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      canvases.add(`${theme}:${metrics.canvas}`)
    }
  }
  // Each theme resolves one canvas, and the two themes are genuinely different.
  expect(canvases.size).toBe(2)
})

test("switches themes through the shared button primitive", async ({ page }) => {
  await page.goto("/?design-lab&theme=dark")
  const dark = await themeMetrics(page)
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true")
  const light = await themeMetrics(page)
  expect(light.theme).toBe("light")
  expect(light.overflow).toBe(false)
  expect(light.textContrast).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  // Switching actually repaints the surface rather than only flipping the attribute.
  expect(light.canvas).not.toBe(dark.canvas)
})

async function themeMetrics(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const read = (token: string) => root.getPropertyValue(token).trim()
    const channel = (value: number) => {
      const ratio = value / 255
      return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4)
    }
    const luminance = (hex: string) => {
      const parsed = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
      if (!parsed) return undefined
      const [red, green, blue] = parsed.slice(1).map((part) => channel(Number.parseInt(part, 16)))
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const canvas = read("--theme-canvas")
    const text = read("--theme-text")
    const canvasLuminance = luminance(canvas)
    const textLuminance = luminance(text)
    const textContrast =
      canvasLuminance === undefined || textLuminance === undefined
        ? 0
        : (Math.max(canvasLuminance, textLuminance) + 0.05) / (Math.min(canvasLuminance, textLuminance) + 0.05)
    return {
      theme: document.documentElement.dataset.theme,
      canvas,
      text,
      textContrast: Number(textContrast.toFixed(2)),
      overflow: document.body.scrollWidth > innerWidth,
    }
  })
}
