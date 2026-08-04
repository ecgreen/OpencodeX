import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  collectSessionDescendants,
  mergeSessionLists,
  sessionGraphEventTouchesTree,
  settleGraphTopology,
  type DescendantSweep,
} from "../src/renderer/src/lib/session-graph-fetch"

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

describe("collecting descendants", () => {
  /** A tree as `parent -> children`; the loader reads from it. */
  const tree = (shape: Record<string, string[]>) => async (sessionID: string) =>
    (shape[sessionID] ?? []).map((id) => session(id, 1))

  test("collects the whole tree breadth first", async () => {
    const sweep = await collectSessionDescendants({
      rootID: "root",
      load: tree({ root: ["a", "b"], a: ["a1"] }),
    })
    expect(sweep?.sessions.map((item) => item.id)).toEqual(["a", "b", "a1"])
    expect(sweep?.failures).toBe(0)
    expect(sweep?.unexpanded).toEqual([])
  })

  test("marks a failed branch as unchecked instead of reading it as childless", async () => {
    const load = async (sessionID: string) => {
      if (sessionID === "a") throw new Error("network down")
      return sessionID === "root" ? [session("a", 1), session("b", 1)] : []
    }
    const sweep = await collectSessionDescendants({ rootID: "root", load })
    expect(sweep?.failures).toBe(1)
    expect(sweep?.error).toBe("network down")
    expect(sweep?.sessions.map((item) => item.id)).toEqual(["a", "b"])
    expect(sweep?.unexpanded).toEqual([{ sessionID: "a", reason: "load_error" }])
  })

  test("marks the branch at the depth bound as unchecked, not as continuing", async () => {
    // An infinite chain: every session has one child.
    let serial = 0
    const load = async () => [session(`chain-${serial++}`, 1)]
    const sweep = await collectSessionDescendants({ rootID: "root", load, maxDepth: 3 })
    expect(sweep?.sessions).toHaveLength(3)
    // The deepest discovered session was never queried - whether it has
    // children is unknown, and the marker says exactly that.
    expect(sweep?.unexpanded).toEqual([{ sessionID: "chain-2", reason: "depth_limit" }])
  })

  test("stops issuing requests the moment the session cap is reached", async () => {
    const calls: string[] = []
    const load = async (sessionID: string) => {
      calls.push(sessionID)
      return sessionID === "root"
        ? Array.from({ length: 10 }, (_, index) => session(`child-${index}`, 1))
        : [session(`${sessionID}-grandchild`, 1)]
    }
    const sweep = await collectSessionDescendants({ rootID: "root", load, maxSessions: 4 })
    expect(sweep?.sessions).toHaveLength(4)
    // One request total: the cap tripped while reading the root's children,
    // so none of the collected children may be queried afterwards.
    expect(calls).toEqual(["root"])
    expect(sweep?.unexpanded).toEqual(
      expect.arrayContaining([
        { sessionID: "root", reason: "session_limit" },
        { sessionID: "child-0", reason: "session_limit" },
      ]),
    )
  })

  test("never exceeds the concurrency bound", async () => {
    let inFlight = 0
    let peak = 0
    const load = async (sessionID: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return sessionID === "root"
        ? Array.from({ length: 30 }, (_, index) => session(`child-${index}`, 1))
        : []
    }
    await collectSessionDescendants({ rootID: "root", load, concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
  })

  test("expands each session against its own directory", async () => {
    const directories: Record<string, string | undefined> = {}
    const load = async (sessionID: string, context: { directory?: string }) => {
      directories[sessionID] = context.directory
      if (sessionID !== "root") return []
      return [{ ...session("worktree-child", 1), directory: "C:/Work/worktree" }]
    }
    await collectSessionDescendants({ rootID: "root", rootDirectory: "C:/Work/main", load })
    expect(directories.root).toBe("C:/Work/main")
    expect(directories["worktree-child"]).toBe("C:/Work/worktree")
  })

  test("a cancelled sweep returns nothing rather than stale data", async () => {
    const sweep = await collectSessionDescendants({
      rootID: "root",
      load: tree({ root: ["a"] }),
      cancelled: () => true,
    })
    expect(sweep).toBeUndefined()
  })
})

describe("settling topology after a sweep", () => {
  const sweep = (overrides: Partial<DescendantSweep>): DescendantSweep => ({
    sessions: [],
    failures: 0,
    unexpanded: [],
    ...overrides,
  })

  test("a clean sweep is ready and applies", () => {
    const settled = settleGraphTopology({ sweep: sweep({ sessions: [session("a", 1)] }), hadDescendants: false })
    expect(settled).toEqual({
      topology: { phase: "ready", refreshing: false, unexpanded: [] },
      apply: true,
    })
  })

  test("a failed refresh keeps the last good tree and marks it stale", () => {
    const settled = settleGraphTopology({
      sweep: sweep({ failures: 1, error: "boom", sessions: [session("a", 1)] }),
      hadDescendants: true,
    })
    expect(settled.apply).toBe(false)
    expect(settled.topology.phase).toBe("stale")
    expect(settled.topology.error).toBe("boom")
  })

  test("a failed first load reports the error outright", () => {
    const settled = settleGraphTopology({ sweep: sweep({ failures: 2, error: "boom" }), hadDescendants: false })
    expect(settled.apply).toBe(false)
    expect(settled.topology.phase).toBe("error")
  })

  test("a partial first load applies what it got, named partial - never stale", () => {
    // There was no previous good load; "showing the last loaded workflow"
    // would be a lie. `partial` is its own honest phase.
    const settled = settleGraphTopology({
      sweep: sweep({ failures: 1, error: "boom", sessions: [session("a", 1)] }),
      hadDescendants: false,
    })
    expect(settled.apply).toBe(true)
    expect(settled.topology.phase).toBe("partial")
  })

  test("unexpanded branches ride along whatever the phase", () => {
    const settled = settleGraphTopology({
      sweep: sweep({ sessions: [session("a", 1)], unexpanded: [{ sessionID: "a", reason: "depth_limit" }] }),
      hadDescendants: false,
    })
    expect(settled.topology.unexpanded).toEqual([{ sessionID: "a", reason: "depth_limit" }])
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
