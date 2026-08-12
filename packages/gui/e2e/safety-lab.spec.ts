import { expect, test, type Page } from "@playwright/test"

/**
 * The question card must never grow internal scrollbars: the context quote
 * clamps with a Show more toggle, and under height pressure the body scrolls
 * as one surface instead of crushing the quote to nothing (the bug where the
 * top of the card became a sliver too short to show a single line).
 */

function questionGeometry(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector(".question-card .safety-card-body")
    const context = document.querySelector(".question-card .question-context")
    const text = document.querySelector(".question-card .question-context-text")
    const box = (el: Element | null) =>
      el instanceof HTMLElement ? { clientH: el.clientHeight, scrollH: el.scrollHeight } : null
    return {
      body: box(body),
      context: box(context),
      text: box(text),
      contextOverflowY: context ? getComputedStyle(context).overflowY : null,
      textLineHeight: text ? Number.parseFloat(getComputedStyle(text).fontSize) * 1.5 : null,
    }
  })
}

test("question card renders in the lab and never scrolls in its default state", async ({ page }) => {
  await page.goto("/lab.html?page=safety&theme=dark")
  const card = page.locator(".question-card").first()
  // Regression: the safety lab mounts the real card, which needs MarkedProvider.
  await expect(card).toBeVisible()

  const geometry = await questionGeometry(page)
  // The context quote is not a scroll container...
  expect(geometry.contextOverflowY).toBe("visible")
  expect(geometry.context!.scrollH).toBeLessThanOrEqual(geometry.context!.clientH + 1)
  // ...and at the standard viewport the body has nothing to scroll either.
  expect(geometry.body!.scrollH).toBeLessThanOrEqual(geometry.body!.clientH + 1)
})

test("long context clamps with Show more instead of scrolling", async ({ page }) => {
  await page.goto("/lab.html?page=safety&theme=dark")
  const card = page.locator(".question-card").first()
  await expect(card).toBeVisible()

  // The lab's mock context is long enough to clamp, so the toggle shows.
  const toggle = card.getByRole("button", { name: "Show more" })
  await expect(toggle).toBeVisible()
  const clamped = await questionGeometry(page)
  expect(clamped.text!.scrollH).toBeGreaterThan(clamped.text!.clientH + 1)

  await toggle.click()
  const expanded = await questionGeometry(page)
  // Expanding reveals the full text - nothing left hidden, still no scrollbar.
  expect(expanded.text!.scrollH).toBeLessThanOrEqual(expanded.text!.clientH + 1)
  await expect(card.getByRole("button", { name: "Show less" })).toBeVisible()
})

test("short windows scroll the body without crushing the context quote", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await page.goto("/lab.html?page=safety&theme=dark")
  await expect(page.locator(".question-card").first()).toBeVisible()

  const geometry = await questionGeometry(page)
  // The quote keeps its clamped height - at least two full lines readable.
  expect(geometry.text!.clientH).toBeGreaterThanOrEqual(geometry.textLineHeight! * 2)
  expect(geometry.context!.scrollH).toBeLessThanOrEqual(geometry.context!.clientH + 1)
  // Height pressure lands on the body, which scrolls as one surface.
  expect(geometry.body!.scrollH).toBeGreaterThan(geometry.body!.clientH)
})
