import { describe, expect, test } from "bun:test"
import type {
  Event,
  Message,
  OpencodeXOperationsSnapshot,
  OpencodeXSessionCardPage,
  OpencodeXSessionSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateSnapshot,
  OpencodeXStateStreamFrame,
  OpencodeXTerminalSession,
  Part,
  Session,
} from "../src/v2/client"
import {
  applyClientSessionSnapshot,
  applyClientSessionCardPage,
  applyClientStateEvent,
  applyClientStateSnapshot,
  createClientStateSync,
  selectClientKnownSessionIDs,
  selectClientOperationsSnapshot,
  selectClientSessionChildren,
  selectClientStateSyncSnapshot,
  selectClientSessionMessages,
  type ClientCapabilitiesSnapshot,
  type ClientStateSyncTransport,
} from "../src/v2/client-sync"

describe("client state sync", () => {
  test("preserves cards omitted by root refresh and prunes only explicit missing IDs", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const first = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First"), session("session-2", "Second")]),
    )
    const unchanged = applyClientStateSnapshot(
      first,
      snapshot("cursor-1", "digest-1", [session("session-1", "First"), session("session-2", "Second")]),
    )
    const changed = applyClientStateSnapshot(first, snapshot("cursor-2", "digest-2", [session("session-2", "Renamed")]))

    expect(unchanged).toBe(first)
    expect(changed.sessions.records["session-2"]).not.toBe(first.sessions.records["session-2"])
    expect(changed.sessions.records["session-2"]?.title).toBe("Renamed")
    expect(changed.sessions.records["session-1"]).toBe(first.sessions.records["session-1"])
    expect(changed.tombstones.sessions["session-1"]).toBeUndefined()

    const missing = applyClientSessionCardPage(changed, {
      items: [],
      hasMore: false,
      missing: ["session-1"],
      sessionUiState: {},
    })
    expect(missing.sessions.records["session-1"]).toBeUndefined()
    expect(missing.tombstones.sessions["session-1"]).toBe(true)
  })

  test("prunes evicted sessions from view members alongside sessionIDs", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const withView = snapshot("cursor-1", "digest-1", [session("session-1", "First"), session("session-2", "Second")])
    withView.payloads.catalog.views = [
      {
        id: "view-1",
        title: "View",
        layout: "list",
        sessionIDs: ["session-1", "session-2"],
        members: [
          { kind: "session", id: "session-1" },
          { kind: "session", id: "session-2" },
          { kind: "terminal", id: "oxts_1" },
        ],
        focusedItemID: "session-1",
        timeCreated: 1,
        timeUpdated: 1,
      },
    ]
    const first = applyClientStateSnapshot(controller.getState(), withView)

    const evicted = applyClientSessionCardPage(first, {
      items: [],
      hasMore: false,
      missing: ["session-1"],
      sessionUiState: {},
    })
    const view = evicted.views.records["view-1"]
    // A stale member id would 400 the next membership PATCH built from it.
    expect(view?.sessionIDs).toEqual(["session-2"])
    expect(view?.members).toEqual([
      { kind: "session", id: "session-2" },
      { kind: "terminal", id: "oxts_1" },
    ])
    expect(view?.focusedItemID).toBe("session-2")
  })

  test("applies changed snapshot content at the same outbox cursor", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const first = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
    )
    const changed = applyClientStateSnapshot(first, snapshot("cursor-1", "digest-2", [session("session-1", "Changed")]))

    expect(changed.sessions.records["session-1"]?.title).toBe("Changed")
    expect(changed).not.toBe(first)
  })

  test("resets root pagination while retaining normalized cards and omitted UI state", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const root = snapshot("cursor-1", "digest-1", [session("session-1", "First")])
    root.payloads.catalog.sessionCards = {
      items: [session("session-1", "First")],
      hasMore: true,
      next: "root-page-2",
      missing: [],
      sessionUiState: { "session-1": sessionUiState("session-1", "needs_review") },
    }
    const first = applyClientStateSnapshot(controller.getState(), root)
    const paged = applyClientSessionCardPage(
      first,
      {
        items: [session("session-2", "Second")],
        hasMore: true,
        next: "root-page-3",
        missing: [],
        sessionUiState: { "session-2": sessionUiState("session-2", "in_progress") },
      },
      { pagination: true },
    )
    const refresh = snapshot("cursor-2", "digest-2", [session("session-1", "Renamed")])
    refresh.payloads.catalog.sessionCards = {
      items: [session("session-1", "Renamed")],
      hasMore: true,
      next: "new-root-page-2",
      missing: [],
      sessionUiState: { "session-1": sessionUiState("session-1", "idle") },
    }
    const refreshed = applyClientStateSnapshot(paged, refresh)

    expect(refreshed.sessionCards).toMatchObject({ pages: 1, hasMore: true, next: "new-root-page-2" })
    expect(refreshed.sessions.records["session-2"]).toBe(paged.sessions.records["session-2"])
    expect(refreshed.sessionUiState["session-2"]).toBe(paged.sessionUiState["session-2"])
    expect(refreshed.sessionUiState["session-1"]?.displayStatus).toBe("idle")

    const removed = applyClientSessionCardPage(refreshed, {
      items: [],
      hasMore: false,
      missing: ["session-2"],
      sessionUiState: {},
    })
    expect(removed.sessionUiState["session-2"]).toBeUndefined()
  })

  test("loads card pages, resolves retained IDs, and preserves canonical references", async () => {
    const root = snapshot("cursor-1", "digest-1", [session("session-1", "First")])
    root.payloads.catalog.sessionCards = {
      items: [session("session-1", "First")],
      hasMore: true,
      next: "page-2",
      missing: [],
      sessionUiState: {},
      sessionUiState: {},
    }
    const transport: ClientStateSyncTransport = {
      snapshot: async () => root,
      cards: async (input) => {
        if (input.cursor === "blocked")
          await new Promise<void>((_resolve, reject) =>
            input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }),
          )
        if (input.sessionIDs)
          return {
            items: input.sessionIDs.includes("old-session") ? [session("old-session", "Old")] : [],
            hasMore: false,
            missing: input.sessionIDs.filter((id) => id !== "old-session"),
            sessionUiState: Object.fromEntries(
              input.sessionIDs
                .filter((id) => id === "old-session")
                .map((id) => [id, sessionUiState(id, "needs_review")]),
            ),
          }
        expect(input.cursor).toBe("page-2")
        return {
          items: [session("session-2", "Second")],
          hasMore: false,
          missing: [],
          sessionUiState: { "session-2": sessionUiState("session-2", "in_progress") },
        }
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "detail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const first = controller.getState().sessions.records["session-1"]

    await controller.loadSessionCards()
    expect(controller.getState().sessions.records["session-1"]).toBe(first)
    expect(controller.getState().sessions.ids).toEqual(["session-2", "session-1"])
    expect(controller.getState().sessionCards).toMatchObject({ hasMore: false, pages: 2, loading: false })

    await controller.ensureSessionCards(["old-session"])
    expect(controller.getState().sessions.records["old-session"]?.title).toBe("Old")
    expect(controller.getState().sessionUiState["old-session"]?.displayStatus).toBe("needs_review")
    await controller.ensureSessionCards(["missing-session"])
    expect(controller.getState().tombstones.sessions["missing-session"]).toBe(true)
    const abort = new AbortController()
    const blocked = controller.loadSessionCards({ cursor: "blocked", signal: abort.signal })
    abort.abort(new Error("cancel cards"))
    await expect(blocked).rejects.toThrow("cancel cards")
    expect(controller.getState().sessionCards.loading).toBe(false)
    expect(controller.getMetrics()).toMatchObject({ sessionCardPages: 2, sessionCardResolutions: 2 })
    controller.stop()
  })

  test("continues paging from a refreshed root boundary", async () => {
    let rootLoads = 0
    const cursors: Array<string | undefined> = []
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        rootLoads += 1
        const root = snapshot(`cursor-${rootLoads}`, "digest-1", [session("session-1", "First")])
        root.payloads.catalog.sessionCards = {
          items: [session("session-1", "First")],
          hasMore: true,
          next: rootLoads === 1 ? "old-page-2" : "new-page-2",
          missing: [],
          sessionUiState: {},
        }
        return root
      },
      cards: async (input) => {
        cursors.push(input.cursor)
        return {
          items: [session(input.cursor === "old-page-2" ? "session-old" : "session-new", "Paged")],
          hasMore: false,
          missing: [],
          sessionUiState: {},
        }
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "detail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.loadSessionCards()
    await controller.refresh()

    expect(controller.getState().sessionCards).toMatchObject({ pages: 1, next: "new-page-2", hasMore: true })
    expect(controller.getState().sessions.records["session-old"]).toBeDefined()
    await controller.loadSessionCards()
    expect(cursors).toEqual(["old-page-2", "new-page-2"])
    expect(controller.getState().sessions.records["session-new"]).toBeDefined()
    controller.stop()
  })

  test("detects aggregate gaps and applies duplicate events once", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const current = applyClientStateSnapshot(controller.getState(), snapshot("cursor-1", "digest-1", []))
    const first = applyClientStateEvent(current, event("cursor-2", 4))
    const duplicate = applyClientStateEvent(first.state, event("cursor-2", 4))
    const gap = applyClientStateEvent(first.state, event("cursor-4", 6))

    expect(first.gap).toBe(false)
    expect(first.state.dirtySessions["session-1"]).toBe(true)
    expect(duplicate.state).toBe(first.state)
    expect(gap.gap).toBe(true)
    expect(gap.state).toBe(first.state)
  })

  test("tracks aggregate sequences independently by visibility", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const current = applyClientStateSnapshot(controller.getState(), snapshot("cursor-1", "digest-1", []))
    const global = applyClientStateEvent(current, catalogEvent("cursor-2", 0, "capabilities", "session.updated"))
    const instance = applyClientStateEvent(global.state, {
      ...catalogEvent("cursor-3", 0, "capabilities", "plugin.added"),
      visibility: "instance",
      domain: "capabilities",
    })

    expect(global.gap).toBe(false)
    expect(instance.gap).toBe(false)
    expect(instance.state.aggregateSequences).toEqual({ "global:capabilities": 0, "instance:capabilities": 0 })
  })

  test("rejects globally reordered state events across aggregates", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const current = applyClientStateSnapshot(controller.getState(), snapshot("cursor-1", "digest-1", []))
    const first = applyClientStateEvent(current, catalogEvent("cursor-10", 0, "session-1", "session.updated", 10))
    const reordered = applyClientStateEvent(first.state, catalogEvent("cursor-9", 0, "session-2", "session.updated", 9))

    expect(first.gap).toBe(false)
    expect(reordered.gap).toBe(true)
    expect(reordered.state).toBe(first.state)
  })

  test("keeps the replay cursor owned by the event stream", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const catalog = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
    )
    const eventState = applyClientStateEvent(catalog, event("cursor-2", 0)).state
    const refreshed = applyClientStateSnapshot(
      eventState,
      snapshot("cursor-3", "digest-2", [session("session-1", "Renamed")]),
    )
    const hydrated = applyClientSessionSnapshot(refreshed, sessionSnapshot("cursor-1", "detail-1", "old"))

    expect(refreshed.cursor).toBe("cursor-2")
    expect(hydrated.cursor).toBe("cursor-2")
    expect(refreshed.sessions.records["session-1"]?.title).toBe("Renamed")
  })

  test("invalidates operations without dirtying catalog or loaded sessions", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const current = applyClientStateSnapshot(controller.getState(), snapshot("cursor-1", "digest-1", []))
    const result = applyClientStateEvent(current, {
      ...event("cursor-2", 0),
      domain: "operations",
      payload: { aggregateID: "job-1", eventType: "opencodex.job.transitioned" },
    })

    expect(result.state.dirtyOperations).toBe(true)
    expect(result.state.dirtyCatalog).toBe(false)
    expect(result.state.dirtySessions).toEqual({})
    expect(selectClientOperationsSnapshot(current)).toEqual({ jobs: [], swarms: [] })
  })

  test("refreshes raw job events through the operations domain without reloading the catalog", async () => {
    let rootLoads = 0
    let operationsLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-root-${++rootLoads}`, `root-${rootLoads}`, []),
      operations: async () =>
        operationsSnapshot(`cursor-operations-${++operationsLoads}`, `operations-${operationsLoads}`),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    expect(
      controller.applyEvent({
        id: "job-transitioned",
        type: "opencodex.job.transitioned",
        properties: { jobID: "job-1", status: "running" },
      }),
    ).toBe(true)
    await waitFor(() => operationsLoads === 1)

    expect(rootLoads).toBe(1)
    expect(controller.getMetrics()).toMatchObject({ rootSnapshots: 1, operationsSnapshots: 1 })
    expect(controller.getState().dirtyCatalog).toBe(false)
    expect(controller.getState().dirtyOperations).toBe(false)
    controller.stop()
  })

  test("refreshes durable operations events without reloading the catalog", async () => {
    let rootLoads = 0
    let operationsLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-root-${++rootLoads}`, `root-${rootLoads}`, []),
      operations: async () =>
        operationsSnapshot(`cursor-operations-${++operationsLoads}`, `operations-${operationsLoads}`),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          yield { type: "heartbeat", epoch: "epoch-1" }
          yield {
            type: "event",
            event: {
              ...event("cursor-2", 0),
              domain: "operations",
              payload: { aggregateID: "job-1", eventType: "opencodex.job.transitioned" },
            },
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()
    await waitFor(() => operationsLoads === 1)

    expect(rootLoads).toBe(1)
    expect(controller.getMetrics()).toMatchObject({ rootSnapshots: 1, operationsSnapshots: 1 })
    expect(controller.getState().dirtyCatalog).toBe(false)
    expect(controller.getState().dirtyOperations).toBe(false)
    controller.stop()
  })

  test("invalidates revisioned capabilities without dirtying root domains", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const current = applyClientStateSnapshot(controller.getState(), snapshot("cursor-1", "digest-1", []))
    const result = applyClientStateEvent(current, {
      ...event("cursor-2", 0),
      domain: "capabilities",
      payload: { aggregateID: "capabilities", eventType: "plugin.added" },
    })

    expect(result.gap).toBe(false)
    expect(result.state.cursor).toBe("cursor-2")
    expect(result.state.dirtyCapabilities).toBe(true)
    expect(result.state.dirtyCatalog).toBe(false)
    expect(result.state.dirtyOperations).toBe(false)
    expect(result.state.dirtySessions).toEqual({})
  })

  test("projects the same filtered catalog shape consumed by GUI and TUI", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const state = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First"), session("session-2", "Second")]),
    )

    expect(
      selectClientStateSyncSnapshot(state, (item) => item.id === "session-2")?.sessions.map((item) => item.id),
    ).toEqual(["session-2"])
  })

  test("replaces authoritative parts while sharing untouched message entities", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const catalog = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
    )
    const first = applyClientSessionSnapshot(catalog, sessionSnapshot("cursor-1", "detail-1", "old"))
    const second = applyClientSessionSnapshot(first, sessionSnapshot("cursor-2", "detail-2", "replacement"))

    expect(second.sessionDetails["session-1"]?.messages["message-1"]).toBe(
      first.sessionDetails["session-1"]?.messages["message-1"],
    )
    expect(second.sessionDetails["session-1"]?.parts["part-1"]).toBe(first.sessionDetails["session-1"]?.parts["part-1"])
    expect(second.sessionDetails["session-1"]?.parts["part-2"]).not.toBe(
      first.sessionDetails["session-1"]?.parts["part-2"],
    )
    expect(selectClientSessionMessages(second, "session-1")[1]?.parts[0]).toMatchObject({
      id: "part-2",
      text: "replacement",
    })
  })

  test("tracks covered deletions while preserving prepended pages", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const catalog = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
    )
    const first = applyClientSessionSnapshot(catalog, sessionSnapshot("cursor-1", "detail-1", "tail"))
    const tail = sessionSnapshot("cursor-2", "detail-2", "tail")
    tail.messages.items = [{ info: message("message-1", 1), parts: [] }]
    tail.messages.coverage = { firstMessageID: "message-1", lastMessageID: "message-1" }
    const deleted = applyClientSessionSnapshot(first, tail)
    const older = sessionSnapshot("cursor-3", "detail-3", "older")
    older.messages.items = [{ info: message("message-0", 0), parts: [part("message-0", "part-0", "older")] }]
    older.messages.coverage = { firstMessageID: "message-0", lastMessageID: "message-0" }
    const prepended = applyClientSessionSnapshot(deleted, older, { prepend: true })

    expect(deleted.sessionDetails["session-1"]?.messageIDs).toEqual(["message-1"])
    expect(deleted.tombstones.messages["message-2"]).toBe(true)
    expect(deleted.tombstones.parts["part-1"]).toBe(true)
    expect(deleted.tombstones.parts["part-2"]).toBe(true)
    expect(prepended.sessionDetails["session-1"]?.messageIDs).toEqual(["message-0", "message-1"])
    expect(prepended.sessionDetails["session-1"]?.messages["message-1"]).toBe(
      deleted.sessionDetails["session-1"]?.messages["message-1"],
    )
  })

  test("does not resurrect tombstoned messages or parts from stale snapshots", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const catalog = applyClientStateSnapshot(
      controller.getState(),
      snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
    )
    const hydrated = applyClientSessionSnapshot(catalog, sessionSnapshot("cursor-1", "detail-1", "old"))
    const tombstoned = {
      ...hydrated,
      tombstones: {
        ...hydrated.tombstones,
        messages: { "message-2": true as const },
        parts: { "part-1": true as const },
      },
    }
    const stale = applyClientSessionSnapshot(tombstoned, sessionSnapshot("cursor-2", "detail-2", "stale"))

    expect(stale.sessionDetails["session-1"]?.messages["message-2"]).toBeUndefined()
    expect(stale.sessionDetails["session-1"]?.parts["part-1"]).toBeUndefined()
    expect(stale.tombstones.messages["message-2"]).toBe(true)
    expect(stale.tombstones.parts["part-1"]).toBe(true)
  })

  test("buffers events during bootstrap and keeps failed mutations outside canonical state", async () => {
    let snapshotLoads = 0
    const stream = async function* () {
      yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
      yield { type: "event", event: event("cursor-2", 0) }
      await new Promise(() => {})
    }
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshotLoads += 1
        return snapshot("cursor-1", "digest-1", [session("session-1", "First")])
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async () => stream(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()
    await Bun.sleep(5)

    expect(controller.getState().phase).toBe("ready")
    expect(controller.getState().dirtyCatalog).toBe(false)
    expect(controller.getState().dirtySessions["session-1"]).toBe(true)
    expect(snapshotLoads).toBe(1)
    const canonical = controller.getState().sessions
    await expect(
      controller.runMutation("seen:session-1", async () => {
        throw new Error("mutation rejected")
      }),
    ).rejects.toThrow("mutation rejected")
    expect(controller.getState().sessions).toBe(canonical)
    expect(controller.getState().pendingMutations["seen:session-1"]).toEqual({
      status: "failed",
      error: "mutation rejected",
    })
    controller.stop()
  })

  test("reports a stable idle connection without snapshot polling", async () => {
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const idle = controller.getMetrics()
    await Bun.sleep(50)

    expect(controller.getMetrics()).toEqual(idle)
    expect(controller.getState().lifecycle).toMatchObject({
      status: "connected",
      data: "current",
      attempt: 0,
    })
    expect(idle).toMatchObject({
      rootSnapshots: 1,
      sessionSnapshots: 0,
      streamConnections: 1,
      streamFrames: 1,
      reconnects: 0,
      resets: 0,
    })
    controller.stop()
  })

  test("keeps authoritative data visible while reconnecting and retries immediately", async () => {
    const state = { connections: 0 }
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) => {
        state.connections += 1
        const connection = state.connections
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          if (connection === 1) return
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({
      transport,
      reconnectDelayMs: 500,
      reconnectJitter: () => 0.5,
      clock: () => 1_000,
    })
    await controller.start()
    const sessions = controller.getState().sessions
    await waitFor(() => controller.getState().lifecycle.status === "reconnecting")

    expect(controller.getState().phase).toBe("ready")
    expect(controller.getState().sessions).toBe(sessions)
    expect(selectClientStateSyncSnapshot(controller.getState())?.sessions.map((item) => item.id)).toEqual(["session-1"])
    expect(controller.getState().lifecycle).toEqual({
      status: "reconnecting",
      data: "stale",
      attempt: 1,
      retryAt: 1_500,
      error: "State stream ended",
    })

    await controller.retry()

    expect(state.connections).toBe(2)
    expect(controller.getState().lifecycle).toEqual({
      status: "connected",
      data: "current",
      attempt: 0,
      connectedAt: 1_000,
    })
    expect(controller.getMetrics().retryActions).toBe(1)
    controller.stop()
  })

  test("uses bounded exponential reconnect backoff", async () => {
    const state = { connections: 0 }
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async () => {
        state.connections += 1
        if (state.connections > 1) throw new Error("offline")
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
        })()
      },
    }
    const controller = createClientStateSync({
      transport,
      reconnectDelayMs: 20,
      reconnectMaxDelayMs: 40,
      reconnectJitter: () => 0.5,
      clock: () => 100,
    })
    await controller.start()
    await waitFor(() => controller.getState().lifecycle.attempt === 2)

    expect(controller.getState().lifecycle).toMatchObject({
      status: "reconnecting",
      data: "stale",
      attempt: 2,
      retryAt: 140,
      error: "offline",
    })
    controller.stop()
  })

  test("resets bounded bootstrap buffering instead of retaining an unbounded stream", async () => {
    const firstSnapshot = Promise.withResolvers<OpencodeXStateSnapshot>()
    let connections = 0
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        if (snapshots === 1) return firstSnapshot.promise
        return snapshot("cursor-2", "digest-2", [])
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) => {
        connections += 1
        const current = connections
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          if (current === 1) {
            for (let index = 0; index <= 1_024; index += 1) yield { type: "heartbeat", epoch: "epoch-1" } as const
            return
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({
      transport,
      reconnectDelayMs: 1,
      reconnectJitter: () => 0.5,
    })
    const started = controller.start().catch((error) => error)
    await waitFor(() => controller.getMetrics().streamFrames > 1_024)
    firstSnapshot.resolve(snapshot("cursor-1", "digest-1", []))

    expect(await started).toMatchObject({ message: "State stream bootstrap buffer overflow" })
    await waitFor(() => connections === 2 && controller.getState().lifecycle.status === "connected")
    expect(controller.getMetrics().queuedFrames).toBe(0)
    controller.stop()
  })

  test("reports initial and older-page session loading independently", async () => {
    const initial = Promise.withResolvers<void>()
    const state = { loads: 0 }
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => {
        state.loads += 1
        if (state.loads === 1) await initial.promise
        if (state.loads === 3) throw new Error("older page failed")
        return sessionSnapshot(`cursor-${state.loads}`, `detail-${state.loads}`, `page-${state.loads}`)
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const loading = controller.refreshSessionTail("session-1")

    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "loading",
      older: "idle",
      error: undefined,
    })
    initial.resolve()
    await loading
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "idle",
      error: undefined,
    })

    await controller.loadOlderSessionPage("session-1", { before: "message-2" })
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "idle",
      error: undefined,
    })
    await expect(controller.loadOlderSessionPage("session-1", { before: "message-1" })).rejects.toThrow(
      "older page failed",
    )
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "error",
      error: "older page failed",
    })
    controller.stop()
  })

  test("runs tail and older-page requests concurrently without crossing lanes", async () => {
    const requests = new Array<{
      input: Parameters<ClientStateSyncTransport["session"]>[0]
      resolve: (snapshot: OpencodeXSessionSnapshot) => void
    }>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: (input) =>
        new Promise<OpencodeXSessionSnapshot>((resolve) => {
          requests.push({ input, resolve })
        }),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const tail = controller.refreshSessionTail("session-1", { limit: 100 })
    const older = controller.loadOlderSessionPage("session-1", { before: "message-2", limit: 50 })
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.input.signal.aborted)).toEqual([false, false])

    const olderSnapshot = singleMessageSessionSnapshot("session-1", "older", "older", "message-1", "older")
    requests[1].resolve(olderSnapshot)
    expect(await older).toBe(olderSnapshot)
    expect(controller.getState().sessionLoads["session-1"]).toMatchObject({
      initial: "loading",
      older: "idle",
    })

    const tailSnapshot = singleMessageSessionSnapshot("session-1", "tail", "tail", "message-2", "tail")
    requests[0].resolve(tailSnapshot)
    expect(await tail).toBe(tailSnapshot)
    expect(selectClientSessionMessages(controller.getState(), "session-1").map((item) => item.info.id)).toEqual([
      "message-1",
      "message-2",
    ])
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "idle",
      error: undefined,
    })
    controller.stop()
  })

  test("aborts matching requests and rejects transport results that arrive late", async () => {
    const requests = new Array<{
      input: Parameters<ClientStateSyncTransport["session"]>[0]
      resolve: (snapshot: OpencodeXSessionSnapshot) => void
    }>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: (input) =>
        new Promise<OpencodeXSessionSnapshot>((resolve) => {
          requests.push({ input, resolve })
        }),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const stale = controller.refreshSessionTail("session-1")
    const staleResult = stale.then(
      () => undefined,
      (error: unknown) => error,
    )
    const current = controller.refreshSessionTail("session-1")
    expect(requests[0].input.signal.aborted).toBe(true)

    requests[1].resolve(singleMessageSessionSnapshot("session-1", "current", "current", "message-2", "current"))
    await current
    requests[0].resolve(singleMessageSessionSnapshot("session-1", "stale", "stale", "message-2", "stale"))
    expect(await staleResult).toMatchObject({ name: "AbortError" })

    expect(selectClientSessionMessages(controller.getState(), "session-1")[0]?.parts[0]).toMatchObject({
      text: "current",
    })
    controller.stop()
  })

  test("honors caller abort signals without applying late session results", async () => {
    const pending = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let requestSignal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: (input) => {
        requestSignal = input.signal
        return pending.promise
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const abort = new AbortController()
    const loading = controller.refreshSessionTail("session-1", { signal: abort.signal }).then(
      () => undefined,
      (error: unknown) => error,
    )

    abort.abort()
    expect(requestSignal?.aborted).toBe(true)
    pending.resolve(singleMessageSessionSnapshot("session-1", "late", "late", "message-2", "late"))

    expect(await loading).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessionDetails["session-1"]).toBeUndefined()
    expect(controller.getState().sessionLoads["session-1"]).toMatchObject({ initial: "idle", older: "idle" })
    controller.stop()
  })

  test("fetches pages without mutating state, notifying, or clearing tail dirtiness", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async (input) =>
        input.before
          ? singleMessageSessionSnapshot("session-1", "fetch", "fetch", "message-1", "fetched")
          : singleMessageSessionSnapshot("session-1", "tail", "tail", "message-2", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield { type: "event", event: event("cursor-2", 0) }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 10_000 })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    releaseEvent.resolve()
    await waitFor(() => Boolean(controller.getState().dirtySessions["session-1"]))

    const before = controller.getState()
    let notifications = 0
    const unsubscribe = controller.subscribe(() => (notifications += 1))
    const page = await controller.fetchSessionPage("session-1", { before: "message-2", limit: 50 })

    expect(page.digest).toBe("fetch")
    expect(controller.getState()).toBe(before)
    expect(controller.getState().dirtySessions["session-1"]).toBe(true)
    expect(notifications).toBe(0)
    unsubscribe()
    controller.stop()
  })

  test("keeps dirty tails through older pages and corrects with the persisted tail options", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    const calls = new Array<Parameters<ClientStateSyncTransport["session"]>[0]>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async (input) => {
        calls.push(input)
        if (input.before) return singleMessageSessionSnapshot("session-1", "older", "older", "message-1", "older")
        return singleMessageSessionSnapshot(
          "session-1",
          `tail-${calls.length}`,
          `tail-${calls.length}`,
          "message-2",
          `tail-${calls.length}`,
        )
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield { type: "event", event: event("cursor-2", 0) }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 20 })
    await controller.start()
    await controller.refreshSessionTail("session-1", { limit: 75 })
    releaseEvent.resolve()
    await waitFor(() => Boolean(controller.getState().dirtySessions["session-1"]))

    await controller.loadOlderSessionPage("session-1", { before: "message-2", limit: 25 })
    expect(controller.getState().dirtySessions["session-1"]).toBe(true)
    await waitFor(() => calls.length === 3 && !controller.getState().dirtySessions["session-1"])

    expect(calls.map((call) => call.before)).toEqual([undefined, "message-2", undefined])
    expect(calls[2].limit).toBe(75)
    controller.stop()
  })

  test("drops cold detail events and replays events received during initial hydration", async () => {
    const pending = Promise.withResolvers<OpencodeXSessionSnapshot>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => pending.promise,
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    controller.applyEvents([
      {
        id: "before-message",
        type: "message.updated",
        properties: { sessionID: "session-1", info: message("message-3", 3) },
      },
      {
        id: "before-part",
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          time: 3,
          part: part("message-3", "part-3", "before"),
        },
      },
    ])
    expect(controller.getMetrics().bufferedSessionEvents).toBe(0)
    const hydration = controller.refreshSessionTail("session-1")
    controller.applyEvents([
      {
        id: "during-message",
        type: "message.updated",
        properties: { sessionID: "session-1", info: message("message-4", 4) },
      },
      {
        id: "during-delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "message-4",
          partID: "part-4",
          field: "text",
          delta: " live",
        },
      },
      {
        id: "during-part",
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          time: 4,
          part: part("message-4", "part-4", "during"),
        },
      },
    ])
    pending.resolve(sessionSnapshot("cursor-tail", "detail-tail", "snapshot"))
    await hydration

    const messages = selectClientSessionMessages(controller.getState(), "session-1")
    expect(messages.find((item) => item.info.id === "message-3")).toBeUndefined()
    expect(messages.find((item) => item.info.id === "message-4")?.parts[0]?.text).toBe("during live")
    expect(controller.getMetrics().bufferedSessionEvents).toBe(0)
    controller.stop()
  })

  test("preserves post-request live updates and schedules a trailing tail correction", async () => {
    const stale = Promise.withResolvers<OpencodeXSessionSnapshot>()
    const trailing = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let loads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => {
        loads += 1
        if (loads === 1) return sessionSnapshot("initial", "initial", "base")
        if (loads === 2) return stale.promise
        return trailing.promise
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, sessionRefreshDelayMs: 0 })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    const refreshing = controller.refreshSessionTail("session-1")
    controller.applyEvent({
      id: "tail-race-live-delta",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-2",
        partID: "part-2",
        field: "text",
        delta: " live",
      },
    })
    stale.resolve(sessionSnapshot("stale", "stale", "stale"))
    await refreshing
    await waitFor(() => loads === 3)

    expect(selectClientSessionMessages(controller.getState(), "session-1")[1]?.parts[0]?.text).toBe("base live")
    trailing.resolve(sessionSnapshot("corrected", "corrected", "corrected"))
    await waitFor(
      () => selectClientSessionMessages(controller.getState(), "session-1")[1]?.parts[0]?.text === "corrected",
    )
    controller.stop()
  })

  test("coalesces card pagination while exact resolutions retain separate loading ownership", async () => {
    const root = snapshot("cursor-1", "digest-1", [session("session-1", "First")])
    root.payloads.catalog.sessionCards = {
      items: [session("session-1", "First")],
      hasMore: true,
      next: "page-2",
      missing: [],
      sessionUiState: {},
    }
    const requests = new Array<{
      input: Parameters<NonNullable<ClientStateSyncTransport["cards"]>>[0]
      resolve: (page: Awaited<ReturnType<NonNullable<ClientStateSyncTransport["cards"]>>>) => void
    }>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => root,
      cards: (input) =>
        new Promise((resolve) => {
          requests.push({ input, resolve })
        }),
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const first = controller.loadSessionCards()
    const second = controller.loadSessionCards()
    const exact = controller.ensureSessionCards(["session-exact"])

    expect(first).toBe(second)
    expect(requests).toHaveLength(2)
    expect(requests[0].input.cursor).toBe("page-2")
    expect(requests[1].input.sessionIDs).toEqual(["session-exact"])
    requests[1].resolve({
      items: [session("session-exact", "Exact")],
      hasMore: false,
      missing: [],
      sessionUiState: { "session-exact": sessionUiState("session-exact", "input_needed") },
    })
    await exact
    expect(controller.getState().sessionCards.loading).toBe(true)
    expect(controller.getState().sessionCards.next).toBe("page-2")

    requests[0].resolve({
      items: [session("session-2", "Second")],
      hasMore: true,
      next: "page-3",
      missing: [],
      sessionUiState: {},
    })
    await first
    expect(controller.getState().sessionCards).toMatchObject({ loading: false, pages: 2, next: "page-3" })

    const stalePage = controller.loadSessionCards()
    expect(requests[2].input.cursor).toBe("page-3")
    controller.applyEvent({
      id: "delete-during-pagination",
      type: "session.deleted",
      properties: { sessionID: "session-2", info: session("session-2", "Deleted") },
    })
    requests[2].resolve({
      items: [session("session-2", "Late pagination")],
      hasMore: false,
      missing: [],
      sessionUiState: { "session-2": sessionUiState("session-2", "needs_review") },
    })
    await stalePage
    expect(controller.getState().sessions.records["session-2"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-2"]).toBe(true)
    controller.stop()
  })

  test("ignores superseded exact-card items and missing results per session", async () => {
    const requests = new Array<{
      resolve: (page: OpencodeXSessionCardPage) => void
    }>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      cards: () =>
        new Promise((resolve) => {
          requests.push({ resolve })
        }),
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const stale = controller.ensureSessionCards(["stale-item", "stale-missing"]).catch((cause) => cause)
    const latest = controller.ensureSessionCards(["stale-item", "stale-missing"])

    requests[1].resolve({
      items: [session("stale-item", "Latest item"), session("stale-missing", "Recreated")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })
    await latest
    requests[0].resolve({
      items: [session("stale-item", "Stale item")],
      hasMore: false,
      missing: ["stale-missing"],
      sessionUiState: {},
    })
    expect(await stale).toMatchObject({ name: "AbortError" })

    expect(controller.getState().sessions.records["stale-item"]?.title).toBe("Latest item")
    expect(controller.getState().sessions.records["stale-missing"]?.title).toBe("Recreated")
    expect(controller.getState().tombstones.sessions["stale-missing"]).toBeUndefined()
    controller.stop()
  })

  test("keeps sync connected when a background card correction is superseded", async () => {
    let snapshots = 0
    const cards = new Array<ReturnType<typeof Promise.withResolvers<OpencodeXSessionCardPage>>>()
    const frames = new Array<ReturnType<typeof Promise.withResolvers<OpencodeXStateStreamFrame>>>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () =>
        snapshot(`cursor-${++snapshots}`, `digest-${snapshots}`, [session("session-1", `Root ${snapshots}`)]),
      cards: () => {
        const request = Promise.withResolvers<OpencodeXSessionCardPage>()
        cards.push(request)
        return request.promise
      },
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async () =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          while (true) {
            const frame = Promise.withResolvers<OpencodeXStateStreamFrame>()
            frames.push(frame)
            yield await frame.promise
          }
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()

    await waitFor(() => frames.length === 1)
    frames[0].resolve({ type: "event", event: catalogEvent("cursor-2", 0, "session-1", "session.updated") })
    await waitFor(() => cards.length === 1)
    await waitFor(() => frames.length === 2)
    frames[1].resolve({ type: "event", event: catalogEvent("cursor-3", 1, "session-1", "session.updated") })
    await waitFor(() => cards.length === 2)

    cards[0].resolve({
      items: [session("session-1", "Stale correction")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })
    await waitFor(() => controller.getMetrics().activeCardRequests === 1)
    cards[1].resolve({
      items: [session("session-1", "Latest correction")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })
    await waitFor(() => controller.getMetrics().activeCardRequests === 0)

    expect(controller.getState().lifecycle).toMatchObject({ status: "connected", data: "current" })
    expect(controller.getState().error).toBeUndefined()
    controller.stop()
  })

  test("does not let stale pagination tombstone a recreated session", async () => {
    const root = snapshot("cursor-1", "digest-1", [
      session("stale-item", "Original item"),
      session("stale-missing", "Original missing"),
    ])
    root.payloads.catalog.sessionCards = {
      items: [session("stale-item", "Original item"), session("stale-missing", "Original missing")],
      hasMore: true,
      next: "page-2",
      missing: [],
      sessionUiState: {},
    }
    const page = Promise.withResolvers<OpencodeXSessionCardPage>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => root,
      cards: () => page.promise,
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const stale = controller.loadSessionCards()
    Array.from(["stale-item", "stale-missing"]).forEach((sessionID) => {
      controller.applyEvent({
        id: `delete-${sessionID}`,
        type: "session.deleted",
        properties: { sessionID, info: session(sessionID, "Deleted") },
      })
      controller.applyEvent({
        id: `recreate-${sessionID}`,
        type: "session.created",
        properties: { info: session(sessionID, `Recreated ${sessionID}`) },
      })
    })
    page.resolve({
      items: [session("stale-item", "Stale item")],
      hasMore: false,
      missing: ["stale-missing"],
      sessionUiState: {},
    })
    await stale

    expect(controller.getState().sessions.records["stale-item"]?.title).toBe("Recreated stale-item")
    expect(controller.getState().sessions.records["stale-missing"]?.title).toBe("Recreated stale-missing")
    expect(controller.getState().tombstones.sessions["stale-missing"]).toBeUndefined()
    controller.stop()
  })

  test("supersedes an exact-card request started between deletion and recreation", async () => {
    const card = Promise.withResolvers<OpencodeXSessionCardPage>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "Original")]),
      cards: () => card.promise,
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    controller.applyEvent({
      id: "delete-before-exact",
      type: "session.deleted",
      properties: { sessionID: "session-1", info: session("session-1", "Deleted") },
    })
    const stale = controller.ensureSessionCards(["session-1"]).catch((cause) => cause)
    controller.applyEvent({
      id: "recreate-after-exact",
      type: "session.created",
      properties: { info: session("session-1", "Recreated") },
    })
    card.resolve({ items: [], hasMore: false, missing: ["session-1"], sessionUiState: {} })

    expect(await stale).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records["session-1"]?.title).toBe("Recreated")
    expect(controller.getState().tombstones.sessions["session-1"]).toBeUndefined()
    controller.stop()
  })

  test("keeps a newer exact-card result ahead of an older root refresh", async () => {
    const root = Promise.withResolvers<OpencodeXStateSnapshot>()
    const card = Promise.withResolvers<OpencodeXSessionCardPage>()
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        if (snapshots === 1) return snapshot("cursor-1", "digest-1", [])
        return root.promise
      },
      cards: () => card.promise,
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const staleRoot = controller.refresh()
    const latest = controller.ensureSessionCards(["session-1"])
    card.resolve({
      items: [session("session-1", "Latest")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })
    await latest
    root.resolve(snapshot("cursor-2", "digest-2", [session("session-1", "Stale root")]))
    await staleRoot

    expect(controller.getState().sessions.records["session-1"]?.title).toBe("Latest")
    controller.stop()
  })

  test("keeps a newer root missing result ahead of an older exact-card item", async () => {
    const root = Promise.withResolvers<OpencodeXStateSnapshot>()
    const card = Promise.withResolvers<OpencodeXSessionCardPage>()
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        if (snapshots === 1) return snapshot("cursor-1", "digest-1", [])
        return root.promise
      },
      cards: () => card.promise,
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const staleCard = controller.ensureSessionCards(["session-1"]).catch((cause) => cause)
    const latestRoot = controller.refresh()
    const missing = snapshot("cursor-2", "digest-2", [])
    missing.payloads.catalog.sessionCards.missing = ["session-1"]
    root.resolve(missing)
    await latestRoot
    card.resolve({
      items: [session("session-1", "Stale exact")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })

    expect(await staleCard).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records["session-1"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-1"]).toBe(true)
    controller.stop()
  })

  test("keeps unaffected sessions from a partially released exact-card batch", async () => {
    const request = Promise.withResolvers<OpencodeXSessionCardPage>()
    let signal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      cards: (input) => {
        signal = input.signal
        return request.promise
      },
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const pending = controller.ensureSessionCards(["released", "retained"]).catch((cause) => cause)

    controller.releaseSession("released")
    expect(signal?.aborted).toBe(false)
    request.resolve({
      items: [session("released", "Released"), session("retained", "Retained")],
      hasMore: false,
      missing: [],
      sessionUiState: {},
    })

    expect(await pending).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records.released).toBeUndefined()
    expect(controller.getState().sessions.records.retained?.title).toBe("Retained")
    controller.stop()
  })

  test("aborts an exact-card batch after every requested session is released", async () => {
    let signal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      cards: (input) => {
        signal = input.signal
        return new Promise((_resolve, reject) =>
          input.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
            once: true,
          }),
        )
      },
      session: async () => sessionSnapshot("tail", "tail", "tail"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const pending = controller.ensureSessionCards(["released-a", "released-b"]).catch((cause) => cause)

    controller.releaseSession("released-a")
    expect(signal?.aborted).toBe(false)
    controller.releaseSession("released-b")

    expect(await pending).toMatchObject({ name: "AbortError" })
    expect(signal?.aborted).toBe(true)
    expect(controller.getMetrics().activeCardRequests).toBe(0)
    controller.stop()
  })

  test("rejects concurrent canonical older mutations and preserves overlapping live content", async () => {
    const older = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let loads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async (input) => {
        loads += 1
        if (!input.before) return sessionSnapshot("tail", "tail", "tail")
        return older.promise
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    const loading = controller.loadOlderSessionPage("session-1", { before: "message-1" })
    await expect(controller.loadOlderSessionPage("session-1", { before: "message-0" })).rejects.toThrow(
      "already active",
    )
    controller.applyEvent({
      id: "older-race-live-delta",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-1",
        partID: "part-1",
        field: "text",
        delta: " live",
      },
    })
    const page = sessionSnapshot("older", "older", "stale")
    page.messages.items = [
      { info: message("message-0", 0), parts: [part("message-0", "part-0", "older")] },
      { info: message("message-1", 1), parts: [part("message-1", "part-1", "stale")] },
    ]
    page.messages.coverage = { firstMessageID: "message-0", lastMessageID: "message-1" }
    older.resolve(page)
    await loading

    expect(loads).toBe(2)
    expect(selectClientSessionMessages(controller.getState(), "session-1").map((item) => item.info.id)).toEqual([
      "message-0",
      "message-1",
      "message-2",
    ])
    expect(selectClientSessionMessages(controller.getState(), "session-1")[1]?.parts[0]?.text).toBe("stable live")
    expect(controller.getState().sessionDetails["session-1"]?.livePartText?.["part-1"]).toEqual({
      base: "stable",
      text: "stable live",
    })
    await controller.refreshSessionTail("session-1")
    expect(loads).toBe(3)
    expect(
      selectClientSessionMessages(controller.getState(), "session-1").find((item) => item.info.id === "message-1")
        ?.parts[0]?.text,
    ).toBe("stable live")
    controller.stop()
  })

  test("releases session resources and pending event buffers in isolation", async () => {
    const pending = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let pendingSignal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () =>
        snapshot("cursor-1", "digest-1", [session("session-1", "First"), session("session-2", "Second")]),
      session: async (input) => {
        if (input.limit === 999) {
          pendingSignal = input.signal
          return pending.promise
        }
        return sessionSnapshot("tail", `tail-${input.sessionID}`, "stable", input.sessionID)
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await Promise.all([controller.refreshSessionTail("session-1"), controller.refreshSessionTail("session-2")])
    const session2Detail = controller.getState().sessionDetails["session-2"]

    controller.applyEvent({
      id: "pending-session-1",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-2",
        partID: "pending-part",
        field: "text",
        delta: " session-1",
      },
    })
    controller.applyEvent({
      id: "pending-session-2",
      type: "message.part.delta",
      properties: {
        sessionID: "session-2",
        messageID: "message-2",
        partID: "pending-part",
        field: "text",
        delta: " session-2",
      },
    })
    controller.applyEvent({
      id: "removed-session-1",
      type: "message.removed",
      properties: { sessionID: "session-1", messageID: "removed-message-1" },
    })
    controller.applyEvent({
      id: "removed-session-2",
      type: "message.removed",
      properties: { sessionID: "session-2", messageID: "removed-message-2" },
    })
    controller.applyEvent({
      id: "removed-part-session-1",
      type: "message.part.removed",
      properties: { sessionID: "session-1", messageID: "message-2", partID: "removed-part-1" },
    })
    controller.applyEvent({
      id: "removed-part-session-2",
      type: "message.part.removed",
      properties: { sessionID: "session-2", messageID: "message-2", partID: "removed-part-2" },
    })

    const late = controller.refreshSessionTail("session-1", { limit: 999 }).then(
      () => undefined,
      (error: unknown) => error,
    )
    controller.releaseSession("session-1")
    expect(pendingSignal?.aborted).toBe(true)
    expect(controller.getState().sessions.ids).toEqual(["session-2", "session-1"])
    expect(controller.getState().sessionDetails["session-1"]).toBeUndefined()
    expect(controller.getState().sessionLoads["session-1"]).toBeUndefined()
    expect(controller.getState().sessionDetails["session-2"]).toBe(session2Detail)
    expect(controller.getState().tombstones.messages["removed-message-1"]).toBeUndefined()
    expect(controller.getState().tombstones.messages["removed-message-2"]).toBe(true)
    expect(controller.getState().tombstones.messageSessions["removed-message-2"]).toBe("session-2")
    expect(controller.getState().tombstones.parts["removed-part-1"]).toBeUndefined()
    expect(controller.getState().tombstones.parts["removed-part-2"]).toBe(true)
    expect(controller.getState().tombstones.partSessions["removed-part-2"]).toBe("session-2")
    pending.resolve(sessionSnapshot("late", "late", "late", "session-1"))
    expect(await late).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessionDetails["session-1"]).toBeUndefined()

    controller.applyEvent({
      id: "part-session-2",
      type: "message.part.updated",
      properties: {
        sessionID: "session-2",
        time: 2,
        part: part("message-2", "pending-part", "base", "session-2"),
      },
    })
    await controller.refreshSessionTail("session-1")
    controller.applyEvent({
      id: "part-session-1",
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        time: 2,
        part: part("message-2", "pending-part", "base", "session-1"),
      },
    })

    expect(
      selectClientSessionMessages(controller.getState(), "session-2")
        .find((item) => item.info.id === "message-2")
        ?.parts.find((item) => item.id === "pending-part")?.text,
    ).toBe("base session-2")
    expect(
      selectClientSessionMessages(controller.getState(), "session-1")
        .find((item) => item.info.id === "message-2")
        ?.parts.find((item) => item.id === "pending-part")?.text,
    ).toBe("base")
    controller.stop()
  })

  test("keeps raw deletion authoritative over every pre-deletion session response and replay", async () => {
    const releaseInvalidation = Promise.withResolvers<void>()
    const sessionRequests = new Array<{
      input: Parameters<ClientStateSyncTransport["session"]>[0]
      resolve: (snapshot: OpencodeXSessionSnapshot) => void
    }>()
    const cardRequest = Promise.withResolvers<OpencodeXSessionCardPage>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      cards: async () => cardRequest.promise,
      session: async (input) => {
        if (input.limit === 50) return sessionSnapshot("initial", "initial", "initial")
        return new Promise((resolve) => sessionRequests.push({ input, resolve }))
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseInvalidation.promise
          yield { type: "event", event: event("cursor-2", 0) }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({
      transport,
      batchMs: 0,
      sessionRefreshDelayMs: 10_000,
    })
    await controller.start()
    await controller.refreshSessionTail("session-1", { limit: 50 })
    const tail = controller.refreshSessionTail("session-1", { limit: 999 }).catch((cause) => cause)
    const older = controller
      .loadOlderSessionPage("session-1", { before: "message-1", limit: 998 })
      .catch((cause) => cause)
    const fetched = controller
      .fetchSessionPage("session-1", { before: "message-1", limit: 997 })
      .catch((cause) => cause)
    const exact = controller.ensureSessionCards(["missing-session"]).catch((cause) => cause)
    releaseInvalidation.resolve()
    await waitFor(() => controller.getMetrics().sessionRefreshTimers === 1)
    controller.applyEvent({
      id: "pending-before-delete",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-2",
        partID: "pending-before-delete",
        field: "text",
        delta: "pending",
      },
    })
    const deleted: Event = {
      id: "authoritative-delete",
      type: "session.deleted",
      properties: { sessionID: "session-1", info: session("session-1", "Deleted") },
    }
    controller.applyEvent({
      id: "authoritative-exact-delete",
      type: "session.deleted",
      properties: { sessionID: "missing-session", info: session("missing-session", "Deleted exact") },
    })
    controller.applyEvent(deleted)

    expect(sessionRequests).toHaveLength(3)
    expect(sessionRequests.every((request) => request.input.signal.aborted)).toBe(true)
    expect(controller.getState().sessions.records["session-1"]).toBeUndefined()
    expect(controller.getState().sessionDetails["session-1"]).toBeUndefined()
    expect(controller.getState().sessionLoads["session-1"]).toBeUndefined()
    expect(controller.getState().dirtySessions["session-1"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-1"]).toBe(true)
    await expect(controller.refreshSessionTail("session-1")).rejects.toMatchObject({ name: "AbortError" })
    expect(controller.getMetrics()).toMatchObject({
      activeSessionRequests: 0,
      activeCardRequests: 0,
      sessionRefreshTimers: 0,
      sessionTailOptions: 0,
      bufferedSessionEvents: 0,
    })

    sessionRequests.forEach((request) =>
      request.resolve(sessionSnapshot("late", `late-${request.input.limit}`, "late")),
    )
    cardRequest.resolve({
      items: [session("missing-session", "Late")],
      hasMore: false,
      missing: [],
      sessionUiState: { "missing-session": sessionUiState("missing-session", "needs_review") },
    })
    for (const result of await Promise.all([tail, older, fetched, exact]))
      expect(result).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records["session-1"]).toBeUndefined()
    expect(controller.getState().sessions.records["missing-session"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-1"]).toBe(true)

    controller.applyEvent({
      id: "created-after-delete",
      type: "session.created",
      properties: { sessionID: "session-1", info: session("session-1", "Recreated") },
    })
    expect(controller.getState().sessions.records["session-1"]?.title).toBe("Recreated")
    controller.applyEvent(deleted)
    expect(controller.getState().sessions.records["session-1"]?.title).toBe("Recreated")
    expect(controller.getState().tombstones.sessions["session-1"]).toBeUndefined()
    controller.stop()
  })

  test("removes replayed deletions immediately and exact-resolves disconnected archives", async () => {
    const root = snapshot("cursor-1", "digest-1", [
      session("session-delete", "Delete"),
      session("session-archive", "Archive"),
    ])
    let snapshots = 0
    const cardRequests: string[][] = []
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        return snapshots === 1 ? root : snapshot(`cursor-${snapshots}`, `digest-${snapshots}`, [])
      },
      cards: async (input) => {
        cardRequests.push(input.sessionIDs ?? [])
        return {
          items: [],
          hasMore: false,
          missing: input.sessionIDs ?? [],
          sessionUiState: {},
        }
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          yield {
            type: "event",
            event: catalogEvent("cursor-2", 0, "session-delete", "session.deleted"),
          }
          yield {
            type: "event",
            event: catalogEvent("cursor-3", 0, "session-archive", "session.updated"),
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()
    await waitFor(() => snapshots >= 2 && cardRequests.length === 1)

    expect(controller.getState().sessions.records["session-delete"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-delete"]).toBe(true)
    expect(cardRequests).toEqual([["session-archive"]])
    expect(controller.getState().sessions.records["session-archive"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-archive"]).toBe(true)
    controller.stop()
  })

  test("exact-resolves off-page interaction invalidations and deduplicates their delayed raw event", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    let rootLoads = 0
    let cardLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-${++rootLoads}`, `digest-${rootLoads}`, []),
      cards: async (input) => {
        cardLoads += 1
        const title = cardLoads === 1 ? "Before" : "After"
        return {
          items: (input.sessionIDs ?? []).map((sessionID) => session(sessionID, title)),
          hasMore: false,
          missing: [],
          sessionUiState: Object.fromEntries(
            (input.sessionIDs ?? []).map((sessionID) => [
              sessionID,
              sessionUiState(sessionID, cardLoads === 1 ? "input_needed" : "idle"),
            ]),
          ),
        }
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield {
            type: "event",
            event: catalogEvent("cursor-2", 0, "session-off-page", "permission.replied"),
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()
    await controller.ensureSessionCards(["session-off-page"])
    releaseEvent.resolve()
    await waitFor(
      () => cardLoads === 2 && controller.getState().sessions.records["session-off-page"]?.title === "After",
    )

    expect(controller.getState().sessionUiState["session-off-page"]?.displayStatus).toBe("idle")
    controller.applyEvent({
      id: "event-cursor-2",
      type: "session.updated",
      properties: { info: session("session-off-page", "Delayed raw") },
    })
    expect(controller.getState().sessions.records["session-off-page"]?.title).toBe("After")
    expect(controller.getMetrics().liveEventDuplicates).toBe(1)
    controller.stop()
  })

  test("aborts stale hydration when exact catalog resolution reports an archive", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    const pendingSession = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let rootLoads = 0
    let sessionSignal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () =>
        snapshot(
          `cursor-${++rootLoads}`,
          `digest-${rootLoads}`,
          rootLoads === 1 ? [session("session-archive", "Archive")] : [],
        ),
      cards: async (input) => ({
        items: [],
        hasMore: false,
        missing: input.sessionIDs ?? [],
        sessionUiState: {},
      }),
      session: async (input) => {
        sessionSignal = input.signal
        return pendingSession.promise
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield {
            type: "event",
            event: catalogEvent("cursor-2", 0, "session-archive", "session.updated"),
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0 })
    await controller.start()
    const hydration = controller.refreshSessionTail("session-archive").catch((cause) => cause)
    releaseEvent.resolve()
    await waitFor(() => Boolean(sessionSignal?.aborted) && controller.getState().tombstones.sessions["session-archive"])

    pendingSession.resolve(sessionSnapshot("late", "late", "late", "session-archive"))
    expect(await hydration).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records["session-archive"]).toBeUndefined()
    controller.stop()
  })

  test("normalizes loading on stop and starts again after aborted work", async () => {
    const pendingSession = Promise.withResolvers<OpencodeXSessionSnapshot>()
    const pendingCards = Promise.withResolvers<OpencodeXSessionCardPage>()
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-${++snapshots}`, `digest-${snapshots}`, [session("session-1", "First")]),
      cards: async () => pendingCards.promise,
      session: async () => pendingSession.promise,
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: `cursor-${snapshots}` }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const tail = controller.refreshSessionTail("session-1").catch((cause) => cause)
    const cards = controller.loadSessionCards().catch((cause) => cause)
    expect(controller.getState().sessionLoads["session-1"]?.initial).toBe("loading")
    expect(controller.getState().sessionCards.loading).toBe(true)

    controller.stop()
    expect(controller.getState().phase).toBe("idle")
    expect(controller.getState().sessionLoads["session-1"]).toMatchObject({ initial: "idle", older: "idle" })
    expect(controller.getState().sessionCards.loading).toBe(false)
    expect(controller.getMetrics()).toMatchObject({ activeSessionRequests: 0, activeCardRequests: 0 })

    await controller.start()
    expect(controller.getState().phase).toBe("ready")
    expect(controller.getState().lifecycle.status).toBe("connected")
    expect(snapshots).toBe(2)
    pendingSession.resolve(sessionSnapshot("late", "late", "late"))
    pendingCards.resolve({
      items: [session("session-late", "Late")],
      hasMore: false,
      missing: [],
      sessionUiState: { "session-late": sessionUiState("session-late", "needs_review") },
    })
    expect(await tail).toMatchObject({ name: "AbortError" })
    expect(await cards).toMatchObject({ name: "AbortError" })
    expect(controller.getState().sessions.records["session-late"]).toBeUndefined()
    controller.stop()
  })

  test("reconciles terminal sessions without loading conversation details", async () => {
    const terminal = terminalSession("terminal-1", "Claude investigation", "project-1")
    const initial = snapshot("cursor-1", "digest-1", [])
    initial.payloads.catalog.terminalSessions = [terminal]
    initial.payloads.catalog.projects = [
      {
        id: "project-1",
        project: {
          id: "project-1",
          worktree: "C:/Work/OpencodeX",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
        folders: [],
        sessionIDs: [],
        terminalSessionIDs: [terminal.id],
      },
    ]
    initial.payloads.catalog.views = [
      {
        id: "view-1",
        title: "Mixed tools",
        layout: "list",
        sessionIDs: [],
        members: [{ kind: "terminal", id: terminal.id }],
        focusedItemID: terminal.id,
        timeCreated: 1,
        timeUpdated: 1,
      },
    ]
    const removed = snapshot("cursor-2", "digest-2", [])
    let snapshots = 0
    let detailLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => (++snapshots === 1 ? initial : removed),
      session: async () => {
        detailLoads += 1
        return sessionSnapshot("cursor-1", "detail-1", "unexpected")
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const state = controller.getState()
    const selected = selectClientStateSyncSnapshot(state)
    expect(state.terminalSessions.records[terminal.id]).toEqual(terminal)
    expect(selected?.terminalSessions[0]).toBe(state.terminalSessions.records[terminal.id])
    expect(selected?.projects[0]?.terminalSessions[0]).toBe(state.terminalSessions.records[terminal.id])
    expect(selected?.views[0]?.terminalSessions[0]).toBe(state.terminalSessions.records[terminal.id])
    expect(selectClientKnownSessionIDs(state)).toEqual(new Set())
    expect(state.sessionDetails).toEqual({})
    expect(detailLoads).toBe(0)

    expect(
      controller.applyEvent({
        id: "terminal-updated",
        type: "opencodex.terminal_session.updated",
        properties: { terminalSessionID: terminal.id },
      }),
    ).toBe(true)
    await waitFor(() => snapshots === 2 && controller.getState().dirtyCatalog === false)
    expect(controller.getState().terminalSessions.records[terminal.id]).toBeUndefined()
    expect(detailLoads).toBe(0)
    controller.stop()
  })

  test("retains and selects project and view-only sessions from the known ID union", () => {
    const projectOnly = { ...session("project-only", "Project only"), project: null }
    const viewOnly = { ...session("view-only", "View only"), parentID: "parent", project: null }
    const firstSnapshot = snapshot("cursor-1", "digest-1", [])
    firstSnapshot.payloads.catalog.projects = [
      {
        id: "project-1",
        project: {
          id: "project-1",
          worktree: "C:/Work/OpencodeX",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
        folders: [],
        sessionIDs: [projectOnly.id],
      },
    ]
    firstSnapshot.payloads.catalog.views = [
      {
        id: "view-1",
        title: "View",
        layout: "list",
        sessionIDs: ["view-only", "view-id-only"],
        timeCreated: 1,
        timeUpdated: 1,
      },
    ]
    const controller = createClientStateSync({ transport: unusedTransport() })
    const catalog = applyClientStateSnapshot(controller.getState(), firstSnapshot)
    const detailed = ["project-only", "view-only", "view-id-only"].reduce(
      (state, sessionID) => applyClientSessionSnapshot(state, sessionSnapshot("tail", sessionID, "detail", sessionID)),
      catalog,
    )
    const nextSnapshot = snapshot("cursor-2", "digest-2", [])
    nextSnapshot.payloads.catalog.projects = firstSnapshot.payloads.catalog.projects
    nextSnapshot.payloads.catalog.views = firstSnapshot.payloads.catalog.views
    const retained = applyClientStateSnapshot(detailed, nextSnapshot)

    expect([...selectClientKnownSessionIDs(retained)].sort()).toEqual(["project-only", "view-id-only", "view-only"])
    expect(selectClientStateSyncSnapshot(retained, () => true)?.projects[0]?.sessionIDs).toEqual(["project-only"])
    expect(selectClientStateSyncSnapshot(retained, () => true)?.projects[0]?.sessions[0]).toBe(
      retained.sessions.records["project-only"],
    )
    expect(Object.keys(retained.sessionDetails).sort()).toEqual(["project-only", "view-id-only", "view-only"])
    expect(
      selectClientStateSyncSnapshot(retained)
        ?.sessions.map((item) => item.id)
        .sort(),
    ).toEqual(["project-only", "view-id-only", "view-only"])
    expect(selectClientSessionChildren(retained, "parent")).toEqual([])

    const omitted = applyClientStateSnapshot(retained, snapshot("cursor-3", "digest-3", []))
    expect(omitted.sessionDetails).toBe(retained.sessionDetails)
    const removed = applyClientSessionCardPage(omitted, {
      items: [],
      hasMore: false,
      missing: ["project-only", "view-id-only", "view-only"],
      sessionUiState: {},
    })
    expect(removed.sessionDetails).toEqual({})
    expect(removed.tombstones.sessions).toMatchObject({
      "project-only": true,
      "view-id-only": true,
      "view-only": true,
    })
  })

  test("prunes incoming project and view references for explicit root misses", () => {
    const next = snapshot("cursor-1", "digest-1", [])
    next.payloads.catalog.projects = [
      {
        id: "project-1",
        project: {
          id: "project-1",
          worktree: "C:/Work/OpencodeX",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
        folders: [],
        sessionIDs: ["session-deleted"],
      },
    ]
    next.payloads.catalog.views = [
      {
        id: "view-1",
        title: "View",
        layout: "list",
        sessionIDs: ["session-deleted"],
        focusedSessionID: "session-deleted",
        timeCreated: 1,
        timeUpdated: 1,
      },
    ]
    next.payloads.catalog.sessionCards.missing = ["session-deleted"]

    const state = applyClientStateSnapshot(createClientStateSync({ transport: unusedTransport() }).getState(), next)

    expect(state.projects.records["project-1"]?.sessionIDs).toEqual([])
    expect(state.views.records["view-1"]?.sessionIDs).toEqual([])
    expect(state.views.records["view-1"]?.focusedSessionID).toBeUndefined()
  })

  test("resets and reconnects when the retention floor rejects the current cursor", async () => {
    let connections = 0
    let snapshots = 0
    let markReconnected = () => {}
    const reconnected = new Promise<void>((resolve) => (markReconnected = resolve))
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        const next = snapshot(snapshots === 1 ? "cursor-1" : "cursor-3", snapshots === 1 ? "digest-1" : "digest-2", [
          session(snapshots === 1 ? "session-1" : "session-2", snapshots === 1 ? "First" : "Second"),
        ])
        next.epoch = "epoch-1"
        return next
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) => {
        connections += 1
        const connection = connections
        return (async function* () {
          yield {
            type: "ready",
            scope: scope(),
            epoch: "epoch-1",
            cursor: connection === 1 ? "cursor-1" : "cursor-3",
          }
          if (connection === 1) {
            yield {
              type: "reset_required",
              scope: scope(),
              epoch: "epoch-1",
              cursor: "cursor-2",
              reason: "cursor is not retained",
            }
          } else markReconnected()
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({ transport, batchMs: 0, reconnectDelayMs: 1 })
    await controller.start()
    await reconnected
    await Bun.sleep(10)

    expect(controller.getState().phase).toBe("ready")
    expect(controller.getState().epoch).toBe("epoch-1")
    expect(controller.getState().sessions.ids).toEqual(["session-2"])
    expect(controller.getMetrics()).toMatchObject({ resets: 1, streamConnections: 2, rootSnapshots: 2 })
    controller.stop()
  })

  test("replays a client-observed gap without clearing retained state", async () => {
    const releaseGap = Promise.withResolvers<void>()
    const after = new Array<string | undefined>()
    const phases = new Array<string>()
    let connections = 0
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        return snapshot("cursor-snapshot", "digest-1", [session("session-1", "First")])
      },
      session: async () => sessionSnapshot("cursor-0", "detail-1", "retained"),
      events: async ({ after: cursor, signal }) => {
        after.push(cursor)
        connections += 1
        const connection = connections
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: cursor ?? "cursor-snapshot" } as const
          if (connection === 1) {
            yield { type: "event", event: event("cursor-0", 0) } as const
            await releaseGap.promise
            yield { type: "event", event: event("cursor-2", 2) } as const
          } else {
            yield { type: "event", event: event("cursor-1", 1) } as const
            yield { type: "event", event: event("cursor-2", 2) } as const
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({
      transport,
      batchMs: 0,
      reconnectDelayMs: 1,
      reconnectJitter: () => 0.5,
      sessionRefreshDelayMs: 10_000,
    })
    controller.subscribe((state) => phases.push(state.phase))
    await controller.start()
    await waitFor(() => controller.getState().cursor === "cursor-0")
    await controller.refreshSessionTail("session-1")
    releaseGap.resolve()
    await waitFor(
      () =>
        connections === 2 &&
        controller.getState().cursor === "cursor-2" &&
        controller.getState().lifecycle.status === "connected",
    )

    expect(after).toEqual([undefined, "cursor-0"])
    expect(phases).not.toContain("resetting")
    expect(controller.getState().sessionDetails["session-1"]?.messages["message-2"]).toBeDefined()
    expect(snapshots).toBe(1)
    expect(controller.getMetrics()).toMatchObject({ resets: 0, reconnects: 1, streamConnections: 2 })
    controller.stop()
  })

  test("polls the authoritative snapshot when the event stream stays idle", async () => {
    let version = 1
    let snapshots = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        return snapshot(
          `cursor-${version}`,
          `digest-${version}`,
          version === 1
            ? [session("session-1", "First")]
            : [session("session-1", "First"), session("session-2", "External")],
        )
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, pollIntervalMs: 10 })
    await controller.start()
    expect(controller.getState().sessions.ids).toEqual(["session-1"])

    version = 2
    await waitFor(() => controller.getState().sessions.ids.includes("session-2"))

    expect(controller.getState().sessions.records["session-2"]?.title).toBe("External")
    expect(snapshots).toBeGreaterThanOrEqual(2)
    expect(controller.getMetrics().streamFrames).toBe(1)
    controller.stop()
  })

  test("retries a failed reset connection and rehydrates retained session details", async () => {
    const releaseReset = Promise.withResolvers<void>()
    let connections = 0
    let snapshots = 0
    let sessionLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        const next = snapshot(`cursor-${snapshots}`, `digest-${snapshots}`, [session("session-1", "First")])
        next.epoch = snapshots === 1 ? "epoch-1" : "epoch-2"
        return next
      },
      session: async () => {
        sessionLoads += 1
        const next = sessionSnapshot(`detail-${sessionLoads}`, `detail-${sessionLoads}`, `load-${sessionLoads}`)
        next.epoch = sessionLoads === 1 ? "epoch-1" : "epoch-2"
        return next
      },
      events: async ({ signal }) => {
        connections += 1
        const current = connections
        if (current === 2) throw new Error("temporarily offline")
        return (async function* () {
          yield {
            type: "ready",
            scope: scope(),
            epoch: current === 1 ? "epoch-1" : "epoch-2",
            cursor: current === 1 ? "cursor-1" : "cursor-2",
          } as const
          if (current === 1) {
            await releaseReset.promise
            yield {
              type: "reset_required",
              scope: scope(),
              epoch: "epoch-1",
              cursor: "cursor-reset",
              reason: "cursor is not retained",
            } as const
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({
      transport,
      batchMs: 0,
      reconnectDelayMs: 1,
      reconnectJitter: () => 0.5,
    })
    await controller.start()
    await controller.refreshSessionTail("session-1", { limit: 75 })
    releaseReset.resolve()
    await waitFor(() => connections === 3 && controller.getState().lifecycle.status === "connected")

    expect(snapshots).toBe(2)
    expect(sessionLoads).toBe(2)
    expect(controller.getState().epoch).toBe("epoch-2")
    expect(controller.getState().sessionDetails["session-1"]?.snapshot.digest).toBe("detail-2")
    expect(controller.getMetrics()).toMatchObject({ resets: 1, reconnects: 1, streamConnections: 3 })
    controller.stop()
  })

  test("reconnects a completed stream without polling or replacing canonical state", async () => {
    let connections = 0
    let snapshots = 0
    let markReconnected = () => {}
    const reconnected = new Promise<void>((resolve) => (markReconnected = resolve))
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        snapshots += 1
        return snapshot("cursor-1", "digest-1", [session("session-1", "First")])
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) => {
        connections += 1
        const connection = connections
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          if (connection === 1) return
          markReconnected()
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    }
    const controller = createClientStateSync({ transport, reconnectDelayMs: 1 })
    await controller.start()
    const sessions = controller.getState().sessions
    await reconnected

    expect(controller.getState().sessions).toBe(sessions)
    expect(snapshots).toBe(1)
    expect(controller.getMetrics()).toMatchObject({ reconnects: 1, streamConnections: 2, rootSnapshots: 1 })
    controller.stop()
  })

  test("coalesces sustained session invalidations into one trailing correction", async () => {
    let releaseEvents = () => {}
    let markEventsWaiting = () => {}
    const eventsWaiting = new Promise<void>((resolve) => (markEventsWaiting = resolve))
    let sessionLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => {
        sessionLoads += 1
        return sessionSnapshot(`cursor-detail-${sessionLoads}`, `detail-${sessionLoads}`, "streaming")
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          markEventsWaiting()
          await new Promise<void>((resolve) => (releaseEvents = resolve))
          for (let index = 0; index < 8; index += 1) {
            yield { type: "event", event: event(`cursor-${index + 2}`, index) }
            await Bun.sleep(3)
          }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 100 })
    await controller.start()
    await eventsWaiting
    await controller.refreshSessionTail("session-1")
    releaseEvents()
    await waitFor(
      () =>
        controller.getMetrics().streamFrames === 9 &&
        sessionLoads === 2 &&
        controller.getState().dirtySessions["session-1"] === undefined,
    )

    expect(controller.getMetrics().streamFrames).toBe(9)
    expect(controller.getMetrics().batches).toBeGreaterThan(1)
    expect(sessionLoads).toBe(2)
    expect(controller.getMetrics().sessionSnapshots).toBe(2)
    expect(controller.getMetrics().sessionInvalidations).toBe(8)
    expect(controller.getMetrics().sessionCorrectionsCoalesced).toBeGreaterThan(0)
    expect(controller.getState().dirtySessions["session-1"]).toBeUndefined()
    controller.stop()
  })

  test("retries a failed authoritative session correction without another event", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    let sessionLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => {
        sessionLoads += 1
        if (sessionLoads === 2) throw new Error("temporary correction failure")
        return sessionSnapshot(
          `cursor-detail-${sessionLoads}`,
          `detail-${sessionLoads}`,
          sessionLoads === 1 ? "old" : "recovered",
        )
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield { type: "event", event: event("cursor-2", 0) }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 5 })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    releaseEvent.resolve()
    await waitFor(() => controller.getState().sessionDetails["session-1"]?.parts["part-2"]?.text === "recovered")

    expect(sessionLoads).toBe(3)
    expect(controller.getState().dirtySessions["session-1"]).toBeUndefined()
    expect(controller.getState().sessionLoads["session-1"]).toMatchObject({ initial: "ready", older: "idle" })
    controller.stop()
  })

  test("applies a content event after its durable invalidation with the same ID", async () => {
    const releaseEvent = Promise.withResolvers<void>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await releaseEvent.promise
          yield { type: "event", event: event("cursor-2", 0) }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 10_000 })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    releaseEvent.resolve()
    await waitFor(() => controller.getState().cursor === "cursor-2")

    expect(
      controller.applyEvent({
        id: "event-cursor-2",
        type: "message.updated",
        properties: { sessionID: "session-1", info: message("message-3", 3) },
      }),
    ).toBe(true)
    expect(controller.getState().sessionDetails["session-1"]?.messages["message-3"]).toBeDefined()
    expect(controller.getMetrics().liveEventDuplicates).toBe(0)
    controller.stop()
  })

  test("polls a changed retained session card and corrects its transcript", async () => {
    let version = 1
    let sessionLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        const current = session("session-1", "First")
        current.time.updated = version
        return snapshot(`cursor-${version}`, `digest-${version}`, [current])
      },
      session: async () => {
        sessionLoads += 1
        const current = sessionSnapshot(
          `cursor-detail-${sessionLoads}`,
          `detail-${sessionLoads}`,
          sessionLoads === 1 ? "old" : "polled",
        )
        current.session.time.updated = version
        return current
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport, pollIntervalMs: 10, sessionRefreshDelayMs: 1 })
    await controller.start()
    await controller.refreshSessionTail("session-1")

    version = 2
    await waitFor(() => controller.getState().sessionDetails["session-1"]?.parts["part-2"]?.text === "polled")

    expect(sessionLoads).toBe(2)
    expect(controller.getState().sessions.records["session-1"]?.time.updated).toBe(2)
    controller.stop()
  })

  test("applies ordered live message batches with one commit and notification", async () => {
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "stable"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    const commits = controller.getMetrics().commits
    const revision = controller.getState().sessionDetails["session-1"]?.revision ?? 0
    let notifications = 0
    const unsubscribe = controller.subscribe(() => (notifications += 1))

    expect(
      controller.applyEvents([
        {
          id: "batch-message",
          type: "message.updated",
          properties: { sessionID: "session-1", info: message("message-3", 3) },
        },
        {
          id: "batch-part",
          type: "message.part.updated",
          properties: {
            sessionID: "session-1",
            time: 2,
            part: part("message-3", "part-3", "hello"),
          },
        },
        {
          id: "batch-delta",
          type: "message.part.delta",
          properties: {
            sessionID: "session-1",
            messageID: "message-3",
            partID: "part-3",
            field: "text",
            delta: " world",
          },
        },
        {
          id: "batch-delta-contiguous",
          type: "message.part.delta",
          properties: {
            sessionID: "session-1",
            messageID: "message-3",
            partID: "part-3",
            field: "text",
            delta: "!",
          },
        },
      ]),
    ).toEqual([true, true, true, true])

    expect(selectClientSessionMessages(controller.getState(), "session-1").at(-1)?.parts).toEqual([
      part("message-3", "part-3", "hello world!"),
    ])
    expect(controller.getState().sessionDetails["session-1"]?.revision).toBe(revision + 3)
    expect(controller.getMetrics()).toMatchObject({ commits: commits + 1, liveEvents: 4 })
    expect(notifications).toBe(1)
    unsubscribe()
    controller.stop()
  })

  test("preserves unfinished live text across a stale tail correction", async () => {
    let sessionLoads = 0
    let authoritativeText = ""
    let completed = false
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => {
        const result = sessionSnapshot(`detail-cursor-${++sessionLoads}`, `detail-${sessionLoads}`, authoritativeText)
        if (completed) {
          const final = result.messages.items[1]?.parts[0]
          if (final?.type === "text") final.time = { start: 1, end: 2 }
        }
        return result
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")

    expect(
      controller.applyEvent({
        id: "live-line-1",
        type: "message.part.delta",
        properties: {
          sessionID: "session-1",
          messageID: "message-2",
          partID: "part-2",
          field: "text",
          delta: "first line\n",
        },
      }),
    ).toBe(true)
    await controller.refreshSessionTail("session-1")
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-2"]).toMatchObject({
      text: "first line\n",
    })
    expect(controller.getState().sessionDetails["session-1"]?.livePartText?.["part-2"]).toEqual({
      base: "",
      text: "first line\n",
    })
    await controller.refreshSessionTail("session-1")
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-2"]).toMatchObject({
      text: "first line\n",
    })

    controller.applyEvent({
      id: "live-line-2",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-2",
        partID: "part-2",
        field: "text",
        delta: "second line",
      },
    })
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-2"]).toMatchObject({
      text: "first line\nsecond line",
    })

    completed = true
    await controller.refreshSessionTail("session-1")
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-2"]).toMatchObject({
      text: "",
      time: { start: 1, end: 2 },
    })
    expect(controller.getState().sessionDetails["session-1"]?.livePartText).toBeUndefined()
    controller.stop()
  })

  test("accepts unfinished authoritative text that differs from the live delta base", async () => {
    let sessionLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () =>
        sessionSnapshot(
          `detail-cursor-${++sessionLoads}`,
          `detail-${sessionLoads}`,
          sessionLoads === 1 ? "base" : "corrected",
        ),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    controller.applyEvent({
      id: "live-before-correction",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-2",
        partID: "part-2",
        field: "text",
        delta: " live",
      },
    })

    await controller.refreshSessionTail("session-1")

    expect(controller.getState().sessionDetails["session-1"]?.parts["part-2"]).toMatchObject({ text: "corrected" })
    expect(controller.getState().sessionDetails["session-1"]?.livePartText).toBeUndefined()
    controller.stop()
  })

  test("deduplicates live event IDs within and across batches", () => {
    const controller = createClientStateSync({ transport: unusedTransport() })
    const first: Event = {
      id: "duplicate-session",
      type: "session.created",
      properties: { sessionID: "session-1", info: session("session-1", "First") },
    }
    const duplicate: Event = {
      id: "duplicate-session",
      type: "session.updated",
      properties: { sessionID: "session-1", info: session("session-1", "Ignored") },
    }

    expect(controller.applyEvents([first, duplicate])).toEqual([true, true])
    expect(controller.getState().sessions.records["session-1"]?.title).toBe("First")
    expect(controller.getMetrics()).toMatchObject({ liveEvents: 1, liveEventDuplicates: 1, commits: 1 })
    expect(controller.applyEvent(duplicate)).toBe(true)
    expect(controller.getMetrics()).toMatchObject({ liveEvents: 1, liveEventDuplicates: 2, commits: 1 })
  })

  test("preserves fallback and invalidation boundaries in live event batches", async () => {
    let rootLoads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-${++rootLoads}`, `digest-${rootLoads}`, [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "stable"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    const commits = controller.getMetrics().commits
    let notifications = 0
    const unsubscribe = controller.subscribe(() => (notifications += 1))

    expect(
      controller.applyEvents([
        {
          id: "batch-busy-before-fallback",
          type: "session.status",
          properties: { sessionID: "session-1", status: { type: "busy" } },
        },
        { id: "batch-fallback", type: "file.edited", properties: { file: "src/index.ts" } },
        { id: "batch-idle-before-invalidation", type: "session.idle", properties: { sessionID: "session-1" } },
        { id: "batch-view-created", type: "opencodex.view.created", properties: { viewID: "view-1" } },
        {
          id: "batch-busy-after-invalidation",
          type: "session.status",
          properties: { sessionID: "session-1", status: { type: "busy" } },
        },
      ]),
    ).toEqual([true, false, true, true, true])

    expect(controller.getMetrics()).toMatchObject({ commits: commits + 4, liveEvents: 4, rootSnapshots: 2 })
    expect(notifications).toBe(4)
    await waitFor(() => !controller.getState().dirtyCatalog)
    expect(rootLoads).toBe(2)
    unsubscribe()
    controller.stop()
  })

  test("reduces live message events once and buffers deltas that arrive before parts", async () => {
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "stable"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")

    expect(
      controller.applyEvent({
        id: "live-message",
        type: "message.updated",
        properties: { sessionID: "session-1", info: message("message-3", 3) },
      }),
    ).toBe(true)
    controller.applyEvent({
      id: "live-delta",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-3",
        partID: "part-3",
        field: "text",
        delta: " world",
      },
    })
    controller.applyEvent({
      id: "live-part",
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        time: 2,
        part: part("message-3", "part-3", "hello"),
      },
    })
    const revision = controller.getState().sessionDetails["session-1"]?.revision
    controller.applyEvent({
      id: "live-part",
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        time: 2,
        part: part("message-3", "part-3", "duplicated"),
      },
    })

    expect(selectClientSessionMessages(controller.getState(), "session-1").at(-1)?.parts).toEqual([
      part("message-3", "part-3", "hello world"),
    ])
    expect(controller.getState().sessionDetails["session-1"]?.revision).toBe(revision)
    expect(controller.getState().sessionDetails["session-1"]?.livePartText?.["part-3"]).toEqual({
      base: "hello",
      text: "hello world",
    })

    controller.applyEvent({
      id: "buffered-part-before-message",
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        time: 3,
        part: part("message-4", "part-4", "buffered"),
      },
    })
    controller.applyEvent({
      id: "buffered-delta-before-message",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-4",
        partID: "part-4",
        field: "text",
        delta: " live",
      },
    })
    controller.applyEvent({
      id: "buffered-message-after-part",
      type: "message.updated",
      properties: { sessionID: "session-1", info: message("message-4", 4) },
    })
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-4"]).toMatchObject({
      text: "buffered live",
    })
    expect(controller.getState().sessionDetails["session-1"]?.livePartText?.["part-4"]).toEqual({
      base: "buffered",
      text: "buffered live",
    })

    const completedBufferedPart: Part = {
      id: "part-5",
      sessionID: "session-1",
      messageID: "message-5",
      type: "text",
      text: "complete",
      time: { start: 4, end: 5 },
    }
    controller.applyEvent({
      id: "buffered-delta-before-completion",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "message-5",
        partID: "part-5",
        field: "text",
        delta: " stale",
      },
    })
    controller.applyEvent({
      id: "buffered-completed-part",
      type: "message.part.updated",
      properties: { sessionID: "session-1", time: 5, part: completedBufferedPart },
    })
    controller.applyEvent({
      id: "buffered-completed-message",
      type: "message.updated",
      properties: { sessionID: "session-1", info: message("message-5", 5) },
    })
    expect(controller.getState().sessionDetails["session-1"]?.parts["part-5"]).toEqual(completedBufferedPart)
    expect(controller.getState().sessionDetails["session-1"]?.livePartText?.["part-5"]).toBeUndefined()
    expect(controller.getMetrics().sessionSnapshots).toBe(1)
    expect(controller.getMetrics().liveEvents).toBe(9)
    expect(controller.getMetrics().liveEventDuplicates).toBe(1)
    controller.stop()
  })

  test("projects live catalog and interaction events through the shared state", async () => {
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", [session("session-1", "First")]),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "stable"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()
    await controller.refreshSessionTail("session-1")
    controller.applyEvent({
      id: "permission-asked",
      type: "permission.asked",
      properties: {
        id: "permission-1",
        sessionID: "session-1",
        permission: "edit",
        patterns: ["src/**"],
        metadata: {},
        always: [],
      },
    })
    controller.applyEvent({
      id: "session-busy",
      type: "session.status",
      properties: { sessionID: "session-1", status: { type: "busy" } },
    })

    expect(selectClientStateSyncSnapshot(controller.getState())?.permissions.map((request) => request.id)).toEqual([
      "permission-1",
    ])
    expect(controller.getState().sessionUiState["session-1"]?.displayStatus).toBe("input_needed")
    expect(controller.getState().sessionDetails["session-1"]?.snapshot.pendingInteractions.permissions).toHaveLength(1)

    controller.applyEvent({
      id: "permission-replied",
      type: "permission.replied",
      properties: { sessionID: "session-1", requestID: "permission-1", reply: "once" },
    })
    const updated = { ...session("session-1", "Updated"), time: { created: 1, updated: 5 } }
    controller.applyEvent({
      id: "session-updated",
      type: "session.updated",
      properties: { sessionID: "session-1", info: updated },
    })

    expect(selectClientStateSyncSnapshot(controller.getState())?.permissions).toEqual([])
    expect(controller.getState().sessionUiState["session-1"]?.displayStatus).toBe("in_progress")
    expect(controller.getState().sessions.records["session-1"]).toEqual(updated)
    expect(controller.getState().sessionDetails["session-1"]?.snapshot.session).toEqual(updated)

    controller.applyEvent({
      id: "session-deleted",
      type: "session.deleted",
      properties: { sessionID: "session-1", info: updated },
    })
    expect(controller.getState().sessions.records["session-1"]).toBeUndefined()
    expect(controller.getState().sessionDetails["session-1"]).toBeUndefined()
    expect(controller.getState().tombstones.sessions["session-1"]).toBe(true)
    controller.stop()
  })

  test("coalesces root refresh bursts into one in-flight request and one trailing correction", async () => {
    let loads = 0
    const releases = new Array<() => void>()
    const transport: ClientStateSyncTransport = {
      snapshot: async () => {
        loads += 1
        if (loads > 1) await new Promise<void>((resolve) => releases.push(resolve))
        return snapshot(`cursor-${loads}`, `digest-${loads}`, [])
      },
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const first = controller.refresh()
    const second = controller.refresh()
    const third = controller.refresh()
    expect(loads).toBe(2)
    releases.shift()?.()
    await Bun.sleep(0)
    expect(loads).toBe(3)
    releases.shift()?.()
    await Promise.all([first, second, third])

    expect(controller.getMetrics().rootSnapshots).toBe(3)
    controller.stop()
  })

  test("invalidates the authoritative root from raw catalog events", async () => {
    let loads = 0
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot(`cursor-${++loads}`, `digest-${loads}`, []),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    expect(
      controller.applyEvent({
        id: "view-created",
        type: "opencodex.view.created",
        properties: { viewID: "view-1" },
      }),
    ).toBe(true)
    await waitFor(() => loads === 2 && controller.getState().dirtyCatalog === false)

    expect(controller.getMetrics().rootSnapshots).toBe(2)
    expect(controller.getState().dirtyCatalog).toBe(false)
    controller.stop()
  })

  test("coalesces revisioned capability refreshes and invalidates them from live events", async () => {
    let loads = 0
    let release = () => {}
    const transport: ClientStateSyncTransport = {
      snapshot: async () => snapshot("cursor-1", "digest-1", []),
      session: async () => sessionSnapshot("cursor-1", "detail-1", "old"),
      capabilities: async () => {
        loads += 1
        if (loads === 1) await new Promise<void>((resolve) => (release = resolve))
        return capabilities(`capabilities-${loads}`)
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const controller = createClientStateSync({ transport })
    await controller.start()

    const first = controller.refreshCapabilities()
    const second = controller.refreshCapabilities()
    const third = controller.refreshCapabilities()
    expect(loads).toBe(1)
    release()
    await Promise.all([first, second, third])

    expect(loads).toBe(2)
    expect(controller.getState().capabilities?.revision).toBe("capabilities-2")
    expect(controller.getMetrics().capabilitySnapshots).toBe(2)
    expect(controller.getMetrics().capabilityRefreshesCoalesced).toBeGreaterThan(0)

    controller.applyEvent({ id: "plugin-added", type: "plugin.added", properties: {} })
    await Bun.sleep(0)
    expect(loads).toBe(3)
    expect(controller.getState().capabilities?.revision).toBe("capabilities-3")
    controller.stop()
  })
})

function scope() {
  return { projectID: "project-1", directory: "C:/Work/OpencodeX" }
}

function snapshot(cursor: string, digest: string, sessions: Session[]): OpencodeXStateSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    digest,
    domains: {
      catalog: { revision: digest, digest },
      operations: { revision: digest, digest },
    },
    payloads: {
      catalog: {
        projects: [],
        sessionCards: { items: sessions, hasMore: false, missing: [], sessionUiState: {} },
        terminalSessions: [],
        views: [],
        sessionStatus: {},
        permissions: [],
        questions: [],
        sessionUiState: {},
      },
      operations: { jobs: [], swarms: [] },
    },
  }
}

function terminalSession(id: string, title: string, projectID?: string): OpencodeXTerminalSession {
  return {
    id,
    driver: "claude-code",
    title,
    projectID,
    directory: "C:/Work/OpencodeX",
    resumeID: "11111111-1111-4111-8111-111111111111",
    installationID: "22222222-2222-4222-8222-222222222222",
    timeCreated: 1,
    timeUpdated: 1,
  }
}

function operationsSnapshot(cursor: string, digest: string): OpencodeXOperationsSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    revision: digest,
    digest,
    payload: { jobs: [], swarms: [] },
  }
}

function sessionSnapshot(
  cursor: string,
  digest: string,
  text: string,
  sessionID = "session-1",
): OpencodeXSessionSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    digest,
    session: session(sessionID, "First"),
    messages: {
      items: [
        { info: message("message-1", 1, sessionID), parts: [part("message-1", "part-1", "stable", sessionID)] },
        { info: message("message-2", 2, sessionID), parts: [part("message-2", "part-2", text, sessionID)] },
      ],
      coverage: { firstMessageID: "message-1", lastMessageID: "message-2" },
      boundary: { hasMore: false },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

function singleMessageSessionSnapshot(
  sessionID: string,
  cursor: string,
  digest: string,
  messageID: string,
  text: string,
) {
  const result = sessionSnapshot(cursor, digest, text, sessionID)
  result.messages.items = [
    { info: message(messageID, 1, sessionID), parts: [part(messageID, `part-${messageID}`, text, sessionID)] },
  ]
  result.messages.coverage = { firstMessageID: messageID, lastMessageID: messageID }
  return result
}

function event(cursor: string, aggregateSequence: number): OpencodeXStateEvent {
  return {
    id: `event-${cursor}`,
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    position: aggregateSequence,
    visibility: "global",
    aggregateSequence,
    domain: "session",
    operation: "invalidate",
    payload: { aggregateID: "session-1", eventType: "message.part.updated" },
  }
}

function catalogEvent(
  cursor: string,
  aggregateSequence: number,
  sessionID: string,
  eventType: string,
  position = Number(cursor.match(/\d+$/)?.[0] ?? aggregateSequence),
): OpencodeXStateEvent {
  return {
    id: `event-${cursor}`,
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    position,
    visibility: "global",
    aggregateSequence,
    domain: "catalog",
    operation: "invalidate",
    payload: { aggregateID: sessionID, eventType },
  }
}

function session(id: string, title: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title,
    version: "test",
    time: { created: 1, updated: 1 },
  }
}

function sessionUiState(sessionID: string, displayStatus: "idle" | "in_progress" | "input_needed" | "needs_review") {
  return { sessionID, reviewedFiles: [], displayStatus, updated: displayStatus !== "idle" }
}

function message(id: string, created: number, sessionID = "session-1"): Message {
  return {
    id,
    sessionID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function part(messageID: string, id: string, text: string, sessionID = "session-1"): Part {
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text,
  }
}

function capabilities(revision: string): ClientCapabilitiesSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    revision,
    providers: [],
    connectedProviderIDs: [],
    providerDefaults: {},
    agents: [],
    commands: [],
    lsp: [],
    mcp: {},
    config: {},
    mcpResources: {},
    plugins: [],
    formatter: [],
  }
}

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 200 })) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out waiting for client state condition")
}

function unusedTransport(): ClientStateSyncTransport {
  return {
    snapshot: async () => {
      throw new Error("unused")
    },
    session: async () => {
      throw new Error("unused")
    },
    events: async () => {
      throw new Error("unused")
    },
  }
}
