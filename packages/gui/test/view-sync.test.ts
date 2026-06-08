import { describe, expect, test } from "bun:test"
import { orderViewSessionsForSync, syncViewSessionsInParallel, viewSessionsInOrder } from "../src/renderer/src/lib/view-sync"

describe("GUI view session sync", () => {
  test("starts all pane loads in parallel while prioritizing the focused session", async () => {
    const started: string[] = []
    const completed: string[] = []
    const resolvers: (() => void)[] = []
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }]

    const syncing = syncViewSessionsInParallel(sessions, "b", async (session) => {
      started.push(session.id)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      completed.push(session.id)
    })

    await Promise.resolve()

    expect(started).toEqual(["b", "a", "c"])
    expect(completed).toEqual([])

    resolvers.forEach((resolve) => resolve())
    await syncing

    expect(completed).toEqual(["b", "a", "c"])
  })

  test("keeps existing order when the focused session is absent", () => {
    expect(orderViewSessionsForSync([{ id: "a" }, { id: "b" }], "missing").map((session) => session.id)).toEqual(["a", "b"])
  })

  test("uses the view-owned session list in view order", () => {
    expect(viewSessionsInOrder({
      sessionIDs: ["b", "missing", "a"],
      sessions: [{ id: "a" }, { id: "b" }, { id: "c" }],
    }).map((session) => session.id)).toEqual(["b", "a"])
  })
})
