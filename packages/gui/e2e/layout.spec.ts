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

        await openWorkbench(page)
        await expect(page.locator(".stage")).toHaveAttribute("data-layout", "full-bleed")
        await expect(page.locator(".stage-content")).toHaveClass(/full-bleed/)
        await expectFullBleed(page, ".workbench-page", ".workbench-files")

        await page.getByRole("button", { name: "Browser", exact: true }).click()
        await expectFullBleed(page, ".workbench-page", ".workbench-browser-host")

        await page.getByRole("button", { name: "Git", exact: true }).click()
        await expectFullBleed(page, ".workbench-page", ".workbench-git-desktop")
      })
    }
  }
}

async function openWorkbench(page: Page) {
  await page.locator(".titlebar-menu-group summary").filter({ hasText: "View" }).click()
  await page.getByRole("button", { name: "Browser / Workbench", exact: true }).click()
  await expect(page.getByRole("navigation", { name: "Workbench tabs" })).toBeVisible()
}

async function expectFullBleed(page: Page, rootSelector: string, leafSelector: string) {
  const geometry = await page.evaluate(
    ({ rootSelector, leafSelector }) => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) throw new Error(`Missing geometry target: ${selector}`)
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom }
      }
      return {
        content: box(".stage-content.full-bleed"),
        root: box(rootSelector),
        leaf: box(leafSelector),
        documentScrolls:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ||
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    },
    { rootSelector, leafSelector },
  )
  expect(Math.abs(geometry.root.x - geometry.content.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.root.y - geometry.content.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.root.width - geometry.content.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.root.height - geometry.content.height)).toBeLessThanOrEqual(1)
  expect(geometry.leaf.width).toBeGreaterThan(0)
  expect(geometry.leaf.height).toBeGreaterThan(0)
  expect(geometry.leaf.bottom).toBeLessThanOrEqual(geometry.root.bottom + 1)
  expect(geometry.documentScrolls).toBe(false)
}

function documentScrolls(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ||
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
}
