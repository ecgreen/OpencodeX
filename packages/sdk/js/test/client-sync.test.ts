import { describe, expect, test } from "bun:test"
import type {
  Message,
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
  selectClientStateSyncSnapshot,
  selectClientSessionMessages,
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
    expect(snapshotLoads).toBe(2)
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
    domains: { catalog: { revision: digest, digest } },
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
    },
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
