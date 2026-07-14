import { describe, expect, test } from "bun:test"
import { createSessionPresentationController } from "../src/renderer/src/lib/session-presentation"

describe("GUI session presentation controller", () => {
  test("pins visible sessions and retains only the most recent inactive entries", () => {
    const controller = createSessionPresentationController({ inactiveLimit: 2 })
    controller.setVisible(["visible"])
    controller.remember("visible")
    controller.remember("oldest")
    controller.remember("middle")

    expect(controller.remember("newest")).toEqual(["oldest"])
    expect(controller.cachedSessionIDs()).toEqual(["visible", "middle", "newest"])
  })

  test("touch updates inactive recency before eviction", () => {
    const controller = createSessionPresentationController({ inactiveLimit: 2 })
    controller.remember("first")
    controller.remember("second")
    controller.touch("first")

    expect(controller.remember("third")).toEqual(["second"])
    expect(controller.cachedSessionIDs()).toEqual(["first", "third"])
  })

  test("deduplicates matching in-flight loads but not distinct pages", async () => {
    const controller = createSessionPresentationController()
    const first = Promise.withResolvers<string>()
    const state = { loads: 0 }
    const load = () => {
      state.loads += 1
      return first.promise
    }

    const one = controller.load("session-1", "tail", load)
    const duplicate = controller.load("session-1", "tail", load)
    const older = controller.load("session-1", "older:message-1", async () => "older")
    expect(one).toBe(duplicate)
    expect(state.loads).toBe(1)
    first.resolve("tail")
    await expect(one).resolves.toBe("tail")
    await expect(older).resolves.toBe("older")
  })

  test("evicts deleted sessions and clears all presentation data on scope changes", () => {
    const controller = createSessionPresentationController()
    controller.reconcile("epoch-1:scope-a", new Set(["session-1", "session-2"]))
    controller.remember("session-1")
    controller.remember("session-2")
    controller.setVisible(["session-2"])

    expect(controller.reconcile("epoch-1:scope-a", new Set(["session-2"]))).toEqual(["session-1"])
    expect(controller.visibleSessionIDs()).toEqual(["session-2"])
    expect(controller.reconcile("epoch-2:scope-b", new Set(["session-2"]))).toEqual(["session-2"])
    expect(controller.cachedSessionIDs()).toEqual([])
    expect(controller.visibleSessionIDs()).toEqual([])
  })
})
