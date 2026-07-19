import { expect, test, type Page } from "@playwright/test"

const viewports = [
  { width: 980, height: 680 },
  { width: 1180, height: 800 },
  { width: 1440, height: 960 },
  { width: 1920, height: 1080 },
] as const

for (const viewport of viewports) {
  for (const theme of ["dark", "light"] as const) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`fills ${viewport.width}x${viewport.height} in ${theme} with ${reducedMotion} motion`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme: theme, reducedMotion })
        await page.addInitScript((mode) => localStorage.setItem("opencodex.gui.theme", mode), theme)
        await page.goto("/")
        await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
        await expect(page.locator(".stage")).toHaveAttribute("data-layout", "scroll-page")
        await expect(page.locator(".stage-content")).toHaveClass(/scroll-page/)
        expect(await documentScrolls(page)).toBe(false)
        await expect(page.locator(".nav-attention-count")).toHaveCount(0)
        await expectDashboardModules(page)
      })
    }
  }
}

async function expectDashboardModules(page: Page) {
  const modules = page.locator(".dashboard-sections > .dashboard-section")
  await expect(modules).toHaveCount(4)
  const geometry = await modules.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }
  }))
  geometry.forEach((item) => {
    expect(item.width).toBeGreaterThan(0)
    expect(item.height).toBeGreaterThan(0)
    expect(item.pointerEvents).not.toBe("none")
  })
  geometry.forEach((item, index) => geometry.slice(index + 1).forEach((other) => {
    const overlapWidth = Math.max(0, Math.min(item.right, other.right) - Math.max(item.left, other.left))
    const overlapHeight = Math.max(0, Math.min(item.bottom, other.bottom) - Math.max(item.top, other.top))
    expect(overlapWidth * overlapHeight).toBe(0)
  }))
}

function documentScrolls(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ||
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
}
