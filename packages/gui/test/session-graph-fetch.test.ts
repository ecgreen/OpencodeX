import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { mergeSessionLists, sessionGraphEventTouchesTree } from "../src/renderer/src/lib/session-graph-fetch"

describe("merging catalog and fetched sessions", () => {
  test("appends fetched sessions the catalog does not carry", () => {
    const merged = mergeSessionLists([session("a", 1)], [session("b", 2), session("c", 3)])
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  test("the newer record wins a conflict, from either side", () => {
    const fresherFetched = mergeSessionLists([session("a", 1, "stale")], [session("a", 5, "fresh")])
    expect(fresherFetched).toHaveLength(1)
    expect(fresherFetched[0]?.title).toBe("fresh")

    const fresherCatalog = mergeSessionLists([session("a", 9, "fresh")], [session("a", 2, "stale")])
    expect(fresherCatalog[0]?.title).toBe("fresh")
  })

  test("keeps catalog order stable and returns the catalog itself when nothing was fetched", () => {
    const catalog = [session("a", 3), session("b", 1), session("c", 2)]
    expect(mergeSessionLists(catalog, [])).toBe(catalog)
    expect(mergeSessionLists(catalog, [session("d", 9)]).map((item) => item.id)).toEqual(["a", "b", "c", "d"])
  })
})

describe("deciding when a live event changes the delegation tree", () => {
  const known = new Set(["root", "child-1"])

  test("a new child under a known session counts", () => {
    expect(
      sessionGraphEventTouchesTree(
        { type: "session.created", properties: { info: { id: "grandchild", parentID: "child-1" } } },
        known,
      ),
    ).toBe(true)
  })

  test("updates and deletions of a known session count", () => {
    expect(
      sessionGraphEventTouchesTree({ type: "session.updated", properties: { info: { id: "child-1" } } }, known),
    ).toBe(true)
    expect(
      sessionGraphEventTouchesTree({ type: "session.deleted", properties: { info: { id: "child-1" } } }, known),
    ).toBe(true)
  })

  test("sessions outside the tree do not count", () => {
    expect(
      sessionGraphEventTouchesTree(
        { type: "session.created", properties: { info: { id: "elsewhere", parentID: "another-root" } } },
        known,
      ),
    ).toBe(false)
  })

  test("status churn and malformed payloads never trigger a refetch", () => {
    expect(
      sessionGraphEventTouchesTree({ type: "session.status", properties: { sessionID: "child-1" } }, known),
    ).toBe(false)
    expect(sessionGraphEventTouchesTree({ type: "session.created" }, known)).toBe(false)
    expect(sessionGraphEventTouchesTree({ type: "session.created", properties: { info: 7 } }, known)).toBe(false)
    expect(sessionGraphEventTouchesTree(undefined, known)).toBe(false)
    expect(sessionGraphEventTouchesTree({ type: 42, properties: {} }, known)).toBe(false)
  })
})

function session(id: string, updated: number, title = id): Session {
  return {
    id,
    slug: id,
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title,
    version: "test",
    time: { created: 1, updated },
  }
}
