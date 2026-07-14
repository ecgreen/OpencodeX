import { describe, expect, test } from "bun:test"
import type {
  Message,
  OpencodeXOperationsSnapshot,
  OpencodeXSessionSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateSnapshot,
  Part,
  Session,
} from "../src/v2/client"
import {
  applyClientSessionSnapshot,
  applyClientStateEvent,
  applyClientStateSnapshot,
  createClientStateSync,
  selectClientOperationsSnapshot,
  selectClientStateSyncSnapshot,
  selectClientSessionMessages,
  type ClientCapabilitiesSnapshot,
  type ClientStateSyncTransport,
} from "../src/v2/client-sync"

describe("client state sync", () => {
  test("preserves untouched entities and records session tombstones", () => {
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
    expect(changed.tombstones.sessions["session-1"]).toBe(true)
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
    const loading = controller.hydrateSession("session-1")

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

    await controller.hydrateSession("session-1", { before: "message-2" })
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "idle",
      error: undefined,
    })
    await expect(controller.hydrateSession("session-1", { before: "message-1" })).rejects.toThrow(
      "older page failed",
    )
    expect(controller.getState().sessionLoads["session-1"]).toEqual({
      initial: "ready",
      older: "error",
      error: "older page failed",
    })
    controller.stop()
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
        next.epoch = snapshots === 1 ? "epoch-1" : "epoch-2"
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
            epoch: connection === 1 ? "epoch-1" : "epoch-2",
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
    expect(controller.getState().epoch).toBe("epoch-2")
    expect(controller.getState().sessions.ids).toEqual(["session-2"])
    expect(controller.getMetrics()).toMatchObject({ resets: 1, streamConnections: 2, rootSnapshots: 2 })
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
    const controller = createClientStateSync({ transport, batchMs: 0, sessionRefreshDelayMs: 20 })
    await controller.start()
    await eventsWaiting
    await controller.hydrateSession("session-1")
    releaseEvents()
    await waitFor(() => sessionLoads === 2)

    expect(controller.getMetrics().streamFrames).toBe(9)
    expect(controller.getMetrics().batches).toBeGreaterThan(1)
    expect(sessionLoads).toBe(2)
    expect(controller.getMetrics().sessionSnapshots).toBe(2)
    expect(controller.getMetrics().sessionInvalidations).toBe(8)
    expect(controller.getMetrics().sessionCorrectionsCoalesced).toBeGreaterThan(0)
    expect(controller.getState().dirtySessions["session-1"]).toBeUndefined()
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
    await controller.hydrateSession("session-1")

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
    expect(controller.getMetrics().sessionSnapshots).toBe(1)
    expect(controller.getMetrics().liveEvents).toBe(3)
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
    await controller.hydrateSession("session-1")
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
    await waitFor(() => loads === 2)

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
        sessions,
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

function sessionSnapshot(cursor: string, digest: string, text: string): OpencodeXSessionSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    digest,
    session: session("session-1", "First"),
    messages: {
      items: [
        { info: message("message-1", 1), parts: [part("message-1", "part-1", "stable")] },
        { info: message("message-2", 2), parts: [part("message-2", "part-2", text)] },
      ],
      coverage: { firstMessageID: "message-1", lastMessageID: "message-2" },
      boundary: { hasMore: false },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

function event(cursor: string, aggregateSequence: number): OpencodeXStateEvent {
  return {
    id: `event-${cursor}`,
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    aggregateSequence,
    domain: "session",
    operation: "invalidate",
    payload: { aggregateID: "session-1", eventType: "message.part.updated" },
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

function message(id: string, created: number): Message {
  return {
    id,
    sessionID: "session-1",
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function part(messageID: string, id: string, text: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text,
  }
}

function capabilities(revision: string): ClientCapabilitiesSnapshot {
  return {
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
