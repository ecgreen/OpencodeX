import { expect, test, type Page } from "@playwright/test"
import { TOOL_OUTPUT_PREVIEW_LIMITS } from "@opencode-ai/ui/tool-output-preview"
import { PERFORMANCE_BUDGETS, environmentCeiling } from "./performance-budgets"
import {
  attachPerformanceReport,
  createPerformanceCapture,
  isCardStatePath,
  isRootStatePath,
  isSessionStatePath,
  measureAuthoritativeClick,
  percentile,
  type PerformanceCapture,
} from "./performance-harness"

const COLD_SESSIONS = [
  "Performance Cold 01",
  "Performance Cold 02",
  "Performance Cold 03",
  "Performance Cold 04",
  "Performance Cold 05",
]

test("production dashboard enforces bounded bootstrap and idle budgets", async ({ page }, testInfo) => {
  const capture = await createPerformanceCapture(page)
  const rootResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" && isRootStatePath(new URL(response.url()).pathname))
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  const response = await rootResponse
  const rootBody = await response.body()
  const root = JSON.parse(rootBody.toString()) as Record<string, unknown>
  await capture.settle()

  const catalog = record(record(record(root.payloads).catalog))
  const cardPage = record(catalog.sessionCards)
  const projects = Array.isArray(catalog.projects) ? catalog.projects.map(record) : []
  const collapsedRailRows = page.locator(".rail-section")
    .filter({ has: page.locator('[aria-expanded="false"]') })
    .locator(".session-link-shell")
  const activeDashboardRows = await page.locator(".dashboard-active-sessions .session-link-shell").count()
  const initialDomElements = await page.locator("*").count()
  const initialSessionRows = await page.locator(".session-link-shell, .dashboard-status-card").count()
  const rootRequests = capture.countRequests(isRootStatePath)
  const cardRequests = capture.countRequests(isCardStatePath)

  expect(Array.isArray(cardPage.items) ? cardPage.items : []).toHaveLength(PERFORMANCE_BUDGETS.enforced.initialCards)
  expect(cardPage.hasMore).toBe(true)
  expect(projects[0]?.sessionIDs).toHaveLength(PERFORMANCE_BUDGETS.enforced.catalogCards)
  expect(rootRequests).toBe(PERFORMANCE_BUDGETS.enforced.initialRootRequests)
  expect(cardRequests).toBe(PERFORMANCE_BUDGETS.enforced.initialCardRequests)
  expect(rootBody.byteLength).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.initialResponseBytes)
  expect(activeDashboardRows).toBe(0)
  expect(collapsedRailRows).toHaveCount(0)
  expect(initialDomElements).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.initialDomElements)
  expect(initialSessionRows).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.initialSessionRows)

  await capture.resetLongTasks()
  await page.waitForTimeout(1_000)
  const idleLongTasks = await capture.longTasks()
  expect(idleLongTasks.maxDuration).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.idleLongTaskMs)
  const metrics = await capture.snapshot()
  const renderer = record(metrics.renderer)
  const details = record(renderer.details)
  const stateSync = record(details.stateSync)
  expect((renderer.userTiming as Array<{ name: string }>).map((entry) => entry.name)).toEqual(expect.arrayContaining([
    "opencodex.renderer.bootstrap",
    "opencodex.renderer.app-mounted",
    "opencodex.renderer.app-shell-mounted",
    "opencodex.renderer.state-connected",
    "opencodex.renderer.authoritative-painted",
  ]))
  expect(Number(record(record(renderer.operationSummaries)["opencodex.renderer.apply-authoritative-state"]).count)).toBeGreaterThan(0)
  expect(Number(stateSync.commits)).toBeGreaterThan(0)
  expect(record(details.retention)).toMatchObject({ cards: 100, canonicalDetails: 0 })
  await attachPerformanceReport(testInfo, "performance-dashboard", {
    fixture: { initialCards: 100, catalogCards: 250 },
    enforced: PERFORMANCE_BUDGETS.enforced,
    observed: {
      rootRequests,
      cardRequests,
      rootResponseBytes: rootBody.byteLength,
      cardResponseBytes: 0,
      initialDomElements,
      initialSessionRows,
      activeDashboardRows,
      idleLongTasks,
    },
    metrics,
  })
  await capture.close()
})

test("production cold session switches use one request and stay below calibrated p95", async ({ page }, testInfo) => {
  const capture = await createPerformanceCapture(page)
  await openDashboard(page, capture)
  await expandPriorSessions(page)
  expect(COLD_SESSIONS).toHaveLength(PERFORMANCE_BUDGETS.enforced.coldSwitchSamples)

  const samples = [] as Array<{ title: string; paintMs: number; requestCount: number; responseBytes: number }>
  for (const title of COLD_SESSIONS) {
    const before = capture.countRequests(isSessionStatePath)
    const response = page.waitForResponse((item) =>
      item.request().method() === "GET" && isSessionStatePath(new URL(item.url()).pathname))
    const paintMs = await measureAuthoritativeClick(page, title, () => sessionButton(page, title).click())
    const body = await (await response).body()
    await expect(page.locator(".session-titleline h1")).toHaveText(title)
    await expect(page.locator(".session-loading-skeleton.visible")).toHaveCount(0)
    const requestCount = capture.countRequests(isSessionStatePath) - before
    expect(requestCount).toBe(PERFORMANCE_BUDGETS.enforced.coldSwitchRequests)
    samples.push({ title, paintMs, requestCount, responseBytes: body.byteLength })
  }

  const paints = samples.map((sample) => sample.paintMs)
  const paint = {
    p50: percentile(paints, 0.5),
    p95: percentile(paints, 0.95),
    max: Math.max(...paints),
    ceiling: environmentCeiling(PERFORMANCE_BUDGETS.enforced.coldSwitchP95Ms),
    target: PERFORMANCE_BUDGETS.aspirational.coldSwitchPaintMs,
  }
  expect(paint.p95).toBeLessThanOrEqual(paint.ceiling)
  const metrics = await capture.snapshot()
  await attachPerformanceReport(testInfo, "performance-cold-switch", {
    enforced: { requestCount: PERFORMANCE_BUDGETS.enforced.coldSwitchRequests, p95Ms: paint.ceiling },
    aspirational: { paintMs: paint.target },
    observed: { samples, paint },
    metrics,
  })
  await capture.close()
})

test("production cached A-B-A switch uses zero additional session requests", async ({ page }, testInfo) => {
  const capture = await createPerformanceCapture(page)
  await openDashboard(page, capture)
  await expandPriorSessions(page)
  await openColdSession(page, capture, "Performance Cache A")
  await openColdSession(page, capture, "Performance Cache B")

  const before = capture.countRequests(isSessionStatePath)
  const paintMs = await measureAuthoritativeClick(page, "Performance Cache A", () => sessionButton(page, "Performance Cache A").click())
  await expect(page.locator(".session-titleline h1")).toHaveText("Performance Cache A")
  const observed = {
    requestCount: capture.countRequests(isSessionStatePath) - before,
    paintMs,
  }
  const ceiling = environmentCeiling(PERFORMANCE_BUDGETS.enforced.cachedSwitchPaintMs)
  expect(observed.requestCount).toBe(PERFORMANCE_BUDGETS.enforced.cachedSwitchRequests)
  expect(observed.paintMs).toBeLessThanOrEqual(ceiling)
  const metrics = await capture.snapshot()
  await attachPerformanceReport(testInfo, "performance-cached-switch", {
    enforced: { requestCount: PERFORMANCE_BUDGETS.enforced.cachedSwitchRequests, paintMs: ceiling },
    aspirational: { paintMs: PERFORMANCE_BUDGETS.aspirational.cachedSwitchPaintMs },
    observed,
    metrics,
  })
  await capture.close()
})

test("production heavy transcript enforces window, anchor, and preview DOM budgets", async ({ page }, testInfo) => {
  const capture = await createPerformanceCapture(page)
  await openDashboard(page, capture)
  await expandPriorSessions(page)
  await openColdSession(page, capture, "Performance Heavy Transcript")
  const messages = page.locator("article.message")
  await expect(messages).toHaveCount(PERFORMANCE_BUDGETS.enforced.transcriptMessages)

  const anchor = page.locator(".transcript-load-more-anchor")
  await anchor.scrollIntoViewIfNeeded()
  await capture.settle()
  const anchorBefore = await anchorTop(page)
  await page.getByRole("button", { name: "Load more", exact: true }).click()
  await expect(messages).toHaveCount(PERFORMANCE_BUDGETS.enforced.messagesAfterLoadMore)
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toBeVisible()
  await capture.settle()
  const anchorAfter = await anchorTop(page)
  const anchorDrift = Math.abs(anchorAfter - anchorBefore)
  expect(anchorDrift).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.loadMoreAnchorDriftCssPx)

  await messages.last().locator("details.part.tool > summary").click()
  await expect(page.locator(".tool-output pre")).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy full output", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy full patch", exact: true })).toBeVisible()
  const preview = await page.evaluate(() => {
    const output = document.querySelector(".tool-output pre")?.textContent ?? ""
    const patch = document.querySelector(".tool-unified-patch")
    const count = (root: ParentNode): number =>
      [...root.querySelectorAll("*")].reduce((total, element) =>
        total + 1 + (element.shadowRoot ? count(element.shadowRoot) : 0), 0)
    return {
      outputBytes: new TextEncoder().encode(output).byteLength,
      outputLines: output ? output.split("\n").length : 0,
      patchDomElements: patch ? count(patch) : 0,
    }
  })
  expect(preview.outputBytes).toBeLessThanOrEqual(TOOL_OUTPUT_PREVIEW_LIMITS.collapsed.maxBytes)
  expect(preview.outputLines).toBeLessThanOrEqual(TOOL_OUTPUT_PREVIEW_LIMITS.collapsed.maxLines)
  expect(preview.patchDomElements).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.enforced.largePreviewDomElements)
  const metrics = await capture.snapshot()
  await attachPerformanceReport(testInfo, "performance-heavy-transcript", {
    fixture: { transcriptMessages: 640, liveTail: 128, olderPage: 384, remainingAfterPage: 128 },
    enforced: {
      transcriptMessages: PERFORMANCE_BUDGETS.enforced.transcriptMessages,
      anchorDriftCssPx: PERFORMANCE_BUDGETS.enforced.loadMoreAnchorDriftCssPx,
      output: TOOL_OUTPUT_PREVIEW_LIMITS.collapsed,
      patchDomElements: PERFORMANCE_BUDGETS.enforced.largePreviewDomElements,
    },
    observed: { anchorBefore, anchorAfter, anchorDrift, preview, messageDom: await messages.count() },
    metrics,
  })
  await capture.close()
})

async function openDashboard(page: Page, capture: PerformanceCapture) {
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await capture.settle()
}

async function expandPriorSessions(page: Page) {
  const toggle = page.locator('[data-rail-section-id="prior"] .section-toggle')
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
}

function sessionButton(page: Page, title: string) {
  return page.locator("button.session-link").filter({ hasText: title }).first()
}

async function openColdSession(page: Page, capture: PerformanceCapture, title: string) {
  const before = capture.countRequests(isSessionStatePath)
  const response = page.waitForResponse((item) =>
    item.request().method() === "GET" && isSessionStatePath(new URL(item.url()).pathname))
  await sessionButton(page, title).click()
  await response
  await expect(page.locator(".session-titleline h1")).toHaveText(title)
  await expect(page.locator(".session-loading-skeleton.visible")).toHaveCount(0)
  await capture.settle()
  expect(capture.countRequests(isSessionStatePath) - before).toBe(PERFORMANCE_BUDGETS.enforced.coldSwitchRequests)
}

function anchorTop(page: Page) {
  return page.locator(".transcript-load-more-anchor").evaluate((element) => {
    const transcript = element.closest(".transcript")
    if (!transcript) throw new Error("Transcript anchor has no scroll owner")
    return element.getBoundingClientRect().top - transcript.getBoundingClientRect().top
  })
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
