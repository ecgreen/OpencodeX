import { describe, expect, test } from "bun:test"
import { orderViewSessionsForSync, syncViewSessionsInParallel, viewSessionsInOrder } from "../src/renderer/src/lib/view-sync"

describe("GUI view session sync", () => {
  test("completes the focused pane before starting background panes", async () => {
    const focused = Promise.withResolvers<void>()
    const events: string[] = []
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }]

    const syncing = syncViewSessionsInParallel(sessions, "b", async (session) => {
      events.push(`start:${session.id}`)
      if (session.id === "b") await focused.promise
      events.push(`complete:${session.id}`)
    })

    await Promise.resolve()
    expect(events).toEqual(["start:b"])

    focused.resolve()
    await syncing
    expect(events).toEqual(["start:b", "complete:b", "start:a", "complete:a", "start:c", "complete:c"])
  })

  test("limits background sync to two panes", async () => {
    const started: string[] = []
    const releases = new Map<string, () => void>()
    let active = 0
    let maximum = 0
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }]

    const syncing = syncViewSessionsInParallel(sessions, "a", async (session) => {
      started.push(session.id)
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.set(session.id, resolve))
      active -= 1
    })

    await Promise.resolve()
    expect(started).toEqual(["a"])
    releases.get("a")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["a", "b", "c"])

    releases.get("b")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["a", "b", "c", "d"])

    releases.get("c")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["a", "b", "c", "d", "e"])

    releases.get("d")?.()
    releases.get("e")?.()
    await syncing
    expect(maximum).toBe(2)
  })

  test("keeps focused 8-pane scheduling deterministic with background concurrency at two", async () => {
    const sessions = Array.from({ length: 8 }, (_, index) => ({ id: `pane-${index}` }))
    const releases = new Map<string, () => void>()
    const started: string[] = []
    let active = 0
    let maximum = 0
    const syncing = syncViewSessionsInParallel(sessions, "pane-3", async (session) => {
      started.push(session.id)
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.set(session.id, resolve))
      active -= 1
    })

    await Promise.resolve()
    expect(started).toEqual(["pane-3"])
    releases.get("pane-3")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["pane-3", "pane-0", "pane-1"])

    while (started.length < sessions.length) {
      const running = started.filter((id) => id !== "pane-3" && releases.has(id))
      running.forEach((id) => {
        releases.get(id)?.()
        releases.delete(id)
      })
      await Promise.resolve()
      await Promise.resolve()
    }
    started.filter((id) => releases.has(id)).forEach((id) => releases.get(id)?.())
    await syncing
    expect(started).toEqual(["pane-3", "pane-0", "pane-1", "pane-2", "pane-4", "pane-5", "pane-6", "pane-7"])
    expect(maximum).toBe(2)
  })

  test("dequeues background panes in view order", async () => {
    const started: string[] = []
    const releases = new Map<string, () => void>()

    const syncing = syncViewSessionsInParallel(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }],
      "b",
      async (session) => {
        started.push(session.id)
        await new Promise<void>((resolve) => releases.set(session.id, resolve))
      },
    )

    await Promise.resolve()
    releases.get("b")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["b", "a", "c"])

    releases.get("c")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["b", "a", "c", "d"])

    releases.get("a")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["b", "a", "c", "d", "e"])

    releases.get("d")?.()
    releases.get("e")?.()
    await syncing
  })

  test("stops queued background work when aborted", async () => {
    const controller = new AbortController()
    const started: string[] = []
    const releases = new Map<string, () => void>()

    const syncing = syncViewSessionsInParallel(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }],
      "a",
      async (session) => {
        started.push(session.id)
        await new Promise<void>((resolve) => releases.set(session.id, resolve))
      },
      controller.signal,
    )

    await Promise.resolve()
    releases.get("a")?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["a", "b", "c"])

    controller.abort()
    releases.get("b")?.()
    releases.get("c")?.()
    await syncing
    expect(started).toEqual(["a", "b", "c"])
  })

  test("continues background panes after focused and worker failures", async () => {
    const attempted: string[] = []
    const failures = await syncViewSessionsInParallel(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      "b",
      async (session) => {
        attempted.push(session.id)
        if (session.id === "b" || session.id === "a") throw new Error(`failed:${session.id}`)
      },
    )

    expect(attempted).toEqual(["b", "a", "c", "d"])
    expect(failures.map((failure) => failure.sessionID)).toEqual(["b", "a"])
    expect(failures.map((failure) => String(failure.cause))).toEqual(["Error: failed:b", "Error: failed:a"])
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
