import { expect, test, type Locator, type Page } from "@playwright/test"

test("keeps manager pages aligned and shared controls usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  const navigation = page.locator(".nav > button")
  await expect(navigation).toHaveCount(4)
  const geometry = await railGeometry(page)
  await testInfo.attach("rail-geometry", {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  })
  for (const button of await navigation.all()) {
    expect(await button.isVisible(), JSON.stringify(geometry, null, 2)).toBe(true)
  }

  const headingTops = {
    projects: await managerHeadingTop(page, "Projects", "Workspace directory"),
    views: await managerHeadingTop(page, "Views", "Views"),
    swarms: await managerHeadingTop(page, "Swarms", "Swarm workspace"),
  }
  const topValues = Object.values(headingTops)
  expect(
    Math.max(...topValues) - Math.min(...topValues),
    JSON.stringify(headingTops),
  ).toBeLessThanOrEqual(4)

  await openRoute(page, "Views")
  await expectPaddedCreateCard(page, "Create view")
  await expectSharedInput(page.locator('input[placeholder="Search views or sessions"]'))

  await openRoute(page, "Swarms")
  await expectPaddedCreateCard(page, "Create swarm")
})

test("reserves dashboard navigation geometry by omitting dynamic counters", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  const dashboard = page.getByRole("button", { name: /^Dashboard:/ })
  const before = await dashboard.boundingBox()
  await page.getByRole("button", { name: /^Projects:/ }).click()
  await dashboard.click()
  const after = await dashboard.boundingBox()
  expect(after).toMatchObject({ width: before?.width, height: before?.height })
  await expect(page.locator(".nav-attention-count")).toHaveCount(0)
})

test("stacks collapsed rail destinations vertically", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  const navigation = page.locator(".nav")
  await expect(navigation.locator(":scope > button")).toHaveCount(4)
  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  await expect(page.locator(".app-shell")).toHaveClass(/rail-collapsed/)

  const geometry = await navigation.evaluate((element) => ({
    display: getComputedStyle(element).display,
    direction: getComputedStyle(element).flexDirection,
    buttons: [...element.children].map((button) => {
      const rect = button.getBoundingClientRect()
      return { x: Math.round(rect.x), y: Math.round(rect.y), right: Math.round(rect.right) }
    }),
  }))
  expect(geometry.display).toBe("flex")
  expect(geometry.direction).toBe("column")
  expect(new Set(geometry.buttons.map((button) => button.x)).size).toBe(1)
  expect(new Set(geometry.buttons.map((button) => button.right)).size).toBe(1)
  expect(geometry.buttons.every((button, index) => index === 0 || button.y > geometry.buttons[index - 1]!.y)).toBe(true)
})

async function managerHeadingTop(page: Page, route: string, heading: string) {
  await openRoute(page, route)
  const layout = route === "Views" ? "full-bleed" : "scroll-page"
  await expect(page.locator(".stage")).toHaveAttribute("data-layout", layout)
  await expect(page.locator(".stage-content")).toHaveClass(new RegExp(`\\b${layout}\\b`))
  const element = page.getByRole("heading", { name: heading, exact: true })
  await expect(element).toBeVisible()
  await element.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  return element.evaluate((node) => Math.round((node.closest("header") ?? node).getBoundingClientRect().top))
}

async function openRoute(page: Page, route: string) {
  await page.getByRole("button", { name: new RegExp(`^${route}:`) }).click()
}

async function expectPaddedCreateCard(page: Page, name: string) {
  const card = page.getByRole("button", { name: new RegExp(`^\\+\\s*${name}`, "i") })
  await expect(card).toBeVisible()
  const geometry = await card.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingTop: Number.parseFloat(style.paddingTop),
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }
  })
  expect(geometry.paddingLeft).toBeGreaterThanOrEqual(12)
  expect(geometry.paddingTop).toBeGreaterThanOrEqual(12)
  expect(geometry.width).toBeGreaterThan(0)
  expect(geometry.height).toBeGreaterThanOrEqual(72)
}

async function expectSharedInput(input: Locator) {
  await expect(input).toBeVisible()
  expect(await input.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(30)
}

async function railGeometry(page: Page) {
  return page.locator(".nav").evaluate((navigation) => {
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }
    const style = (element: Element) => {
      const computed = getComputedStyle(element)
      return {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        overflow: computed.overflow,
        position: computed.position,
      }
    }
    return {
      appClass: document.querySelector(".app-shell")?.className,
      rail: navigation.closest(".rail") ? rect(navigation.closest(".rail")!) : undefined,
      navigation: {
        rect: rect(navigation),
        style: style(navigation),
        columns: getComputedStyle(navigation).gridTemplateColumns,
      },
      buttons: [...navigation.children].map((element) => ({
        label: element.getAttribute("aria-label"),
        rect: rect(element),
        style: style(element),
      })),
    }
  })
}
