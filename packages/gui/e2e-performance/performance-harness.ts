import type { CDPSession, Page, TestInfo } from "@playwright/test"
import { writeFile } from "node:fs/promises"

const SAFE_PATH_SEGMENTS = new Set([
  "agent",
  "assets",
  "capabilities",
  "command",
  "config",
  "event",
  "experimental",
  "file",
  "find",
  "global",
  "health",
  "index.html",
  "message",
  "opencodex",
  "operations",
  "path",
  "permission",
  "project",
  "provider",
  "question",
  "session",
  "session-card",
  "state",
  "status",
])

type NetworkRequest = {
  path: string
  method: string
  bytes: number
  resourceType?: string
  status?: number
}

type LongTaskState = {
  longTasks: number[]
  observer?: PerformanceObserver
}

export type PerformanceCapture = Awaited<ReturnType<typeof createPerformanceCapture>>

export async function createPerformanceCapture(page: Page) {
  await page.addInitScript(() => {
    Reflect.set(window, "__opencodexPerformanceEnabled", true)
    const state: LongTaskState = { longTasks: [] }
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      state.observer = new PerformanceObserver((list) => {
        state.longTasks.push(...list.getEntries().map((entry) => entry.duration))
      })
      state.observer.observe({ type: "longtask", buffered: true })
    }
    Reflect.set(window, "__opencodexPerformanceCapture", state)
  })

  const cdp = await page.context().newCDPSession(page)
  await Promise.all([
    cdp.send("Network.enable"),
    cdp.send("Performance.enable"),
  ])
  const requests = new Map<string, NetworkRequest>()
  cdp.on("Network.requestWillBeSent", (input) => {
    const event = input as { requestId: string; request: { url: string; method: string }; type?: string }
    requests.set(event.requestId, {
      path: new URL(event.request.url).pathname,
      method: event.request.method,
      bytes: 0,
      resourceType: event.type,
    })
  })
  cdp.on("Network.responseReceived", (input) => {
    const event = input as { requestId: string; response: { status: number } }
    const request = requests.get(event.requestId)
    if (request) request.status = event.response.status
  })
  cdp.on("Network.dataReceived", (input) => {
    const event = input as { requestId: string; encodedDataLength: number }
    const request = requests.get(event.requestId)
    if (request) request.bytes += event.encodedDataLength
  })
  cdp.on("Network.loadingFinished", (input) => {
    const event = input as { requestId: string; encodedDataLength: number }
    const request = requests.get(event.requestId)
    if (request) request.bytes = Math.max(request.bytes, event.encodedDataLength)
  })

  return {
    countRequests: (match: (path: string) => boolean) =>
      [...requests.values()].filter((request) => request.method !== "OPTIONS" && match(request.path)).length,
    async resetLongTasks() {
      await page.evaluate(() => {
        const state = Reflect.get(window, "__opencodexPerformanceCapture") as LongTaskState | undefined
        state?.observer?.takeRecords()
        if (state) state.longTasks.length = 0
      })
    },
    async longTasks() {
      return page.evaluate(() => {
        const state = Reflect.get(window, "__opencodexPerformanceCapture") as LongTaskState | undefined
        if (!state) return { supported: false, durations: [], count: 0, totalDuration: 0, maxDuration: 0 }
        state.longTasks.push(...(state.observer?.takeRecords() ?? []).map((entry) => entry.duration))
        return {
          supported: Boolean(state.observer),
          durations: [...state.longTasks],
          count: state.longTasks.length,
          totalDuration: state.longTasks.reduce((total, duration) => total + duration, 0),
          maxDuration: Math.max(0, ...state.longTasks),
        }
      })
    },
    async settle() {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    },
    async snapshot() {
      const [renderer, cdpMetrics, domCounters, heap] = await Promise.all([
        rendererMetrics(page),
        readCdpMetrics(cdp),
        readDomCounters(cdp),
        readHeap(cdp),
      ])
      return {
        renderer,
        cdp: { metrics: cdpMetrics, domCounters, heap },
        network: networkSummary(requests),
      }
    },
    close: () => cdp.detach(),
  }
}

export async function attachPerformanceReport(testInfo: TestInfo, name: string, report: unknown) {
  const body = JSON.stringify({ renderer: "production-vite-assets", ...asRecord(report) }, null, 2)
  const path = testInfo.outputPath(`${name}.json`)
  await writeFile(path, body)
  await testInfo.attach(name, {
    path,
    contentType: "application/json",
  })
}

export function isRootStatePath(path: string) {
  return path === "/experimental/opencodex/state"
}

export function isCardStatePath(path: string) {
  return path === "/experimental/opencodex/state/session-card"
}

export function isSessionStatePath(path: string) {
  return /^\/experimental\/opencodex\/state\/session\/[^/]+$/.test(path)
}

export function percentile(values: readonly number[], value: number) {
  if (values.length === 0) return 0
  const ordered = values.toSorted((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(value * ordered.length) - 1)] ?? 0
}

export async function measureAuthoritativeClick(page: Page, title: string, click: () => Promise<void>) {
  await page.evaluate((expectedTitle) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button.session-link")]
      .find((element) => element.textContent?.includes(expectedTitle))
    if (!button) throw new Error(`Session button not found: ${expectedTitle}`)
    let started: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: MutationObserver | undefined
    const promise = new Promise<number>((resolve, reject) => {
      const finish = () => {
        if (started === undefined) return
        if (document.querySelector(".session-titleline h1")?.textContent?.trim() !== expectedTitle) return
        if (document.querySelector(".session-loading-skeleton.visible")) return
        observer?.disconnect()
        if (timer !== undefined) clearTimeout(timer)
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started!)))
      }
      button.addEventListener("click", () => {
        started = performance.now()
        observer = new MutationObserver(finish)
        observer.observe(document.body, { childList: true, subtree: true, attributes: true })
        timer = setTimeout(() => {
          observer?.disconnect()
          reject(new Error(`Authoritative session paint timed out: ${expectedTitle}`))
        }, 15_000)
        finish()
      }, { capture: true, once: true })
    })
    Reflect.set(window, "__opencodexAuthoritativeClick", promise)
  }, title)
  await click()
  return page.evaluate(async () => {
    const pending = Reflect.get(window, "__opencodexAuthoritativeClick")
    if (!(pending instanceof Promise)) throw new Error("Authoritative click measurement was not installed")
    try {
      return await pending as number
    } finally {
      Reflect.deleteProperty(window, "__opencodexAuthoritativeClick")
    }
  })
}

async function rendererMetrics(page: Page) {
  return page.evaluate(() => ({
    domElementCount: document.querySelectorAll("*").length,
    userTiming: [...performance.getEntriesByType("mark"), ...performance.getEntriesByType("measure")]
      .filter((entry) => entry.name.startsWith("opencodex."))
      .map((entry) => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
      }))
      .toSorted((left, right) => left.startTime - right.startTime),
    operationSummaries: Reflect.get(window, "__opencodexPerformanceMetrics") ?? {},
    details: Reflect.get(window, "__opencodexPerformanceDetails") ?? {},
  }))
}

async function readCdpMetrics(cdp: CDPSession) {
  try {
    const result = await cdp.send("Performance.getMetrics") as { metrics: Array<{ name: string; value: number }> }
    return { supported: true, values: Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value])) }
  } catch (cause) {
    return unavailable(cause)
  }
}

async function readDomCounters(cdp: CDPSession) {
  try {
    const result = await cdp.send("Memory.getDOMCounters") as { documents: number; nodes: number; jsEventListeners: number }
    return { supported: true, ...result }
  } catch (cause) {
    return unavailable(cause)
  }
}

async function readHeap(cdp: CDPSession) {
  try {
    const before = await cdp.send("Runtime.getHeapUsage") as { usedSize: number; totalSize: number; embedderHeapUsedSize?: number }
    await cdp.send("HeapProfiler.collectGarbage")
    const after = await cdp.send("Runtime.getHeapUsage") as { usedSize: number; totalSize: number; embedderHeapUsedSize?: number }
    return { supported: true, beforeGc: before, afterGc: after }
  } catch (cause) {
    return unavailable(cause)
  }
}

function networkSummary(requests: Map<string, NetworkRequest>) {
  const paths = [...requests.values()].reduce<Record<string, { requests: number; bytes: number }>>((result, request) => {
    const path = safePath(request.path)
    const current = result[path] ?? { requests: 0, bytes: 0 }
    result[path] = { requests: current.requests + 1, bytes: current.bytes + request.bytes }
    return result
  }, {})
  return {
    requests: requests.size,
    applicationRequests: [...requests.values()].filter((request) => request.method !== "OPTIONS").length,
    preflightRequests: [...requests.values()].filter((request) => request.method === "OPTIONS").length,
    bytes: [...requests.values()].reduce((total, request) => total + request.bytes, 0),
    paths: Object.fromEntries(Object.entries(paths).toSorted(([left], [right]) => left.localeCompare(right))),
  }
}

function safePath(path: string) {
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return "/"
  return `/${segments.map((segment) => SAFE_PATH_SEGMENTS.has(segment) ? segment : ":value").join("/")}`
}

function unavailable(cause: unknown) {
  return { supported: false, reason: cause instanceof Error ? cause.message : String(cause) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : { value }
}
