import { describe, expect, test } from "bun:test"
import {
  BROWSER_CAPTURE_MAX_ENCODED_BYTES,
  browserCaptureEncodedBytes,
  fitBrowserCaptureDimensions,
  shrinkBrowserCaptureDimensions,
} from "../src/main/browser-capture-limits"
import { createKeyedSingleFlight, ownerHasResourceCapacity } from "../src/main/native-resource-limits"
import {
  WORKBENCH_EDITABLE_FILE_BYTES,
  WORKBENCH_PATCH_BYTES,
  WORKBENCH_PREVIEW_FILE_BYTES,
  boundedWorkbenchFile,
  utf8ByteLength,
} from "../src/renderer/src/lib/file-resource-limits"
import {
  reserveOpenTabSlot,
  sessionReplacementCleanupTabs,
  touchBoundedLRU,
  updateBoundedExplorerCache,
  updateBoundedLRUEntries,
  updateWeightedLRUEntries,
} from "../src/renderer/src/lib/resource-limits"
import { openPanelStateBytes } from "../src/renderer/src/components/session-side-open-state"

describe("native resource limits", () => {
  test("applies hard caps per owner rather than globally", () => {
    const resources = [...Array.from({ length: 8 }, () => ({ ownerID: 1 })), ...Array.from({ length: 7 }, () => ({ ownerID: 2 }))]
    expect(ownerHasResourceCapacity(resources, 1)).toBe(false)
    expect(ownerHasResourceCapacity(resources, 2)).toBe(true)
  })

  test("evicts the least-recently used dormant browser", () => {
    const touched = touchBoundedLRU(["a", "b", "c", "d"], "e", 4, new Set(["e"]))
    expect(touched).toEqual({ order: ["b", "c", "d", "e"], evicted: ["a"] })
    expect(touchBoundedLRU(touched.order, "b", 4).order).toEqual(["c", "d", "e", "b"])
  })

  test("coalesces concurrent screenshot work by browser ID", async () => {
    const requests = createKeyedSingleFlight<string, string>()
    let release = (value: string) => undefined
    const pending = new Promise<string>((resolve) => { release = resolve })
    let calls = 0
    const first = requests.run("browser", () => { calls += 1; return pending })
    const second = requests.run("browser", () => { calls += 1; return Promise.resolve("other") })
    expect(first).toBe(second)
    expect(calls).toBe(0)
    await Promise.resolve()
    expect(calls).toBe(1)
    release("capture")
    expect(await second).toBe("capture")
    expect(requests.size()).toBe(0)
  })

  test("bounds screenshot dimensions and encoded size calculations", () => {
    expect(fitBrowserCaptureDimensions({ width: 4096, height: 1024 })).toEqual({ width: 2048, height: 512 })
    expect(fitBrowserCaptureDimensions({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 })
    expect(browserCaptureEncodedBytes(6 * 1024 * 1024)).toBeGreaterThan(BROWSER_CAPTURE_MAX_ENCODED_BYTES)
    const shrunk = shrinkBrowserCaptureDimensions({ width: 2048, height: 2048 }, 16 * 1024 * 1024)
    expect(shrunk.width).toBeLessThan(2048)
    expect(shrunk.height).toBeLessThan(2048)
  })
})

describe("renderer resource limits", () => {
  test("keeps workspace state in a 12-session LRU", () => {
    const initial = Array.from({ length: 12 }, (_, index) => [`session-${index}`, index] as const)
    const next = updateBoundedLRUEntries(initial, "session-12", 12, 12)
    expect(next.entries).toHaveLength(12)
    expect(next.evicted).toEqual([["session-0", 0]])
    expect(updateBoundedLRUEntries(next.entries, "session-2", 2, 12).entries.at(-1)).toEqual(["session-2", 2])
  })

  test("bounds workspace state by estimated bytes as well as session count", () => {
    const state = (text: string) => ({ tabs: [{ id: text, input: "", title: "", kind: "file" as const, text, original: text }], activeID: text })
    const first = state("a".repeat(1024))
    const second = state("b".repeat(1024))
    const maxWeight = openPanelStateBytes(first) + openPanelStateBytes(second) - 1
    const next = updateWeightedLRUEntries({
      entries: [["first", first]],
      key: "second",
      value: second,
      maxEntries: 12,
      maxWeight,
      weight: openPanelStateBytes,
    })
    expect(next.entries.map(([key]) => key)).toEqual(["second"])
    expect(next.evicted.map(([key]) => key)).toEqual(["first"])
    expect(next.weight).toBeLessThanOrEqual(maxWeight)
  })

  test("evicts only clean inactive tabs and identifies session replacement cleanup", () => {
    const tabs = Array.from({ length: 16 }, (_, index) => ({ id: `${index}`, dirty: index === 0 }))
    const slot = reserveOpenTabSlot({ tabs, active: tabs[1], clean: (tab) => !tab.dirty, limit: 16 })
    expect(slot.available).toBe(true)
    expect(slot.evicted.map((tab) => tab.id)).toEqual(["2"])
    expect(sessionReplacementCleanupTabs(tabs, false)).toEqual(tabs)
    expect(sessionReplacementCleanupTabs(tabs, true)).toEqual([])
  })

  test("bounds explorer cache by folder and aggregate node counts", () => {
    const folders = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`folder-${index}`, [index]]))
    const next = updateBoundedExplorerCache({
      cache: folders,
      order: Object.keys(folders),
      path: "latest",
      nodes: Array.from({ length: 1_950 }, (_, index) => index),
      maxFolders: 64,
      maxNodes: 2_000,
    })
    expect(Object.keys(next.cache).length).toBeLessThanOrEqual(64)
    expect(Object.values(next.cache).flat()).toHaveLength(2_000)
    expect(next.cache.latest).toHaveLength(1_950)
  })

  test("retains protected explorer roots while evicting older folders", () => {
    const next = updateBoundedExplorerCache({
      cache: { "": ["root"], old: ["old"] },
      order: ["", "old"],
      path: "new",
      nodes: ["new"],
      maxFolders: 2,
      maxNodes: 2,
      protectedPaths: new Set([""]),
    })
    expect(next.cache).toEqual({ "": ["root"], new: ["new"] })
    expect(next.evicted).toEqual(["old"])
  })
})

describe("file resource limits", () => {
  test("uses UTF-8 bytes for editable and preview limits", () => {
    const multibyte = "🙂".repeat(Math.floor(WORKBENCH_EDITABLE_FILE_BYTES / 4) + 1)
    expect(utf8ByteLength(multibyte)).toBeGreaterThan(WORKBENCH_EDITABLE_FILE_BYTES)
    expect(boundedWorkbenchFile({ type: "text", content: multibyte }).mode).toBe("preview")
    const oversized = boundedWorkbenchFile({ type: "text", content: "é".repeat(WORKBENCH_PREVIEW_FILE_BYTES / 2 + 1) })
    expect(oversized.mode).toBe("metadata")
    expect(oversized.content.content).toBe("")
    expect(boundedWorkbenchFile({
      type: "text",
      content: "",
      bytes: WORKBENCH_PREVIEW_FILE_BYTES + 1,
      truncated: true,
    })).toEqual({
      content: {
        type: "text",
        content: "",
        bytes: WORKBENCH_PREVIEW_FILE_BYTES + 1,
        truncated: true,
      },
      bytes: WORKBENCH_PREVIEW_FILE_BYTES + 1,
      mode: "metadata",
    })
  })

  test("uses a fixed selected-patch transport ceiling", () => {
    expect(WORKBENCH_PATCH_BYTES).toBe(2 * 1024 * 1024)
  })
})
