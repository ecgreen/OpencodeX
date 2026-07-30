import { describe, expect, test } from "bun:test"
import type { Event, Message, OpencodeXSessionSnapshot, OpencodeXStateSnapshot, Part, Session } from "../src/v2/client"
import {
  applyClientSessionSnapshot,
  applyClientStateSnapshot,
  createClientSeenIdRing,
  createClientStateSync,
  selectClientSessionMessages,
  type ClientStateSyncState,
  type ClientStateSyncTransport,
} from "../src/v2/client-sync"
import { applyClientSessionEvent, createClientSessionEventBuffers } from "../src/v2/client-sync-events"

const MESSAGE_COUNT = 40
const PARTS_PER_MESSAGE = 8

describe("client sync two-level part keying", () => {
  test("a streaming delta leaves every untouched message's part record identical", () => {
    const before = hydrate()
    const target = { messageID: messageID(MESSAGE_COUNT - 1), partID: partID(MESSAGE_COUNT - 1, 0) }
    const after = apply(before, {
      id: "delta-1",
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: target.messageID,
        partID: target.partID,
        field: "text",
        delta: " more",
      },
    })

    const previous = detailOf(before)
    const next = detailOf(after)
    expect(next).not.toBe(previous)
    expect(next.parts[target.messageID]).not.toBe(previous.parts[target.messageID])
    expect(next.parts[target.messageID]?.[target.partID]).toMatchObject({ text: "text-0 more" })

    const untouched = Object.keys(previous.parts).filter((id) => id !== target.messageID)
    expect(untouched.length).toBe(MESSAGE_COUNT - 1)
    untouched.forEach((id) => expect(next.parts[id]).toBe(previous.parts[id]))

    // Siblings inside the one rebuilt message record keep their identity too.
    Object.keys(previous.parts[target.messageID]!)
      .filter((id) => id !== target.partID)
      .forEach((id) => expect(next.parts[target.messageID]![id]).toBe(previous.parts[target.messageID]![id]))

    expect(next.livePartText?.[target.partID]).toEqual({ base: "text-0", text: "text-0 more" })
  })

  test("part records are nested under their message and still flatten through the selector", () => {
    const state = hydrate()
    const detail = detailOf(state)
    expect(Object.keys(detail.parts)).toEqual(Array.from({ length: MESSAGE_COUNT }, (_, index) => messageID(index)))
    Object.entries(detail.parts).forEach(([owner, parts]) =>
      Object.values(parts).forEach((part) => expect(part.messageID).toBe(owner)),
    )
    const messages = selectClientSessionMessages(state, "session-1")
    expect(messages.length).toBe(MESSAGE_COUNT)
    expect(messages[3]?.parts.map((item) => item.id)).toEqual(
      Array.from({ length: PARTS_PER_MESSAGE }, (_, index) => partID(3, index)),
    )
  })

  test("removing a message drops its whole part record and tombstones each part", () => {
    const hydrated = hydrate()
    const removed = apply(hydrated, {
      id: "message-removed",
      type: "message.removed",
      properties: { sessionID: "session-1", messageID: messageID(2) },
    })
    const detail = detailOf(removed)
    expect(detail.parts[messageID(2)]).toBeUndefined()
    expect(detail.partIDs[messageID(2)]).toBeUndefined()
    expect(detail.parts[messageID(1)]).toBe(detailOf(hydrated).parts[messageID(1)])
    Array.from({ length: PARTS_PER_MESSAGE }, (_, index) => partID(2, index)).forEach((id) =>
      expect(removed.tombstones.parts[id]).toBe(true),
    )
    expect(removed.tombstones.messages[messageID(2)]).toBe(true)
  })

  test("a part tombstone survives a stale snapshot and clears when the part comes back", () => {
    const hydrated = hydrate()
    const tombstoned = apply(hydrated, {
      id: "part-removed",
      type: "message.part.removed",
      properties: { sessionID: "session-1", messageID: messageID(1), partID: partID(1, 0) },
    })
    expect(tombstoned.tombstones.parts[partID(1, 0)]).toBe(true)
    expect(detailOf(tombstoned).parts[messageID(1)]?.[partID(1, 0)]).toBeUndefined()
    expect(detailOf(tombstoned).partIDs[messageID(1)]).not.toContain(partID(1, 0))
    expect(detailOf(tombstoned).parts[messageID(2)]).toBe(detailOf(hydrated).parts[messageID(2)])

    // A stale snapshot still carrying the deleted part must not resurrect it.
    const stale = applyClientSessionSnapshot(tombstoned, sessionSnapshot("cursor-2", "digest-2"))
    expect(detailOf(stale).parts[messageID(1)]?.[partID(1, 0)]).toBeUndefined()
    expect(stale.tombstones.parts[partID(1, 0)]).toBe(true)

    // Live re-creation clears the tombstone and re-nests the part under its message.
    const restored = apply(stale, {
      id: "part-restored",
      type: "message.part.updated",
      properties: { sessionID: "session-1", time: 9, part: part(1, 0, "restored") },
    })
    expect(restored.tombstones.parts[partID(1, 0)]).toBeUndefined()
    expect(detailOf(restored).parts[messageID(1)]?.[partID(1, 0)]).toMatchObject({ text: "restored" })
    expect(detailOf(restored).parts[messageID(2)]).toBe(detailOf(stale).parts[messageID(2)])
  })

  test("a snapshot refresh reuses the whole parts record when nothing changed", () => {
    const first = hydrate()
    const second = applyClientSessionSnapshot(first, sessionSnapshot("cursor-2", "digest-2"))
    expect(detailOf(second).parts).toBe(detailOf(first).parts)
    expect(detailOf(second).revision).toBe(detailOf(first).revision + 1)
  })

  test("a snapshot refresh rebuilds only the message whose part changed", () => {
    const first = hydrate()
    const changed = sessionSnapshot("cursor-2", "digest-2")
    changed.messages.items[5]!.parts[0] = part(5, 0, "updated")
    const second = applyClientSessionSnapshot(first, changed)
    expect(detailOf(second).parts[messageID(5)]).not.toBe(detailOf(first).parts[messageID(5)])
    expect(detailOf(second).parts[messageID(5)]?.[partID(5, 0)]).toMatchObject({ text: "updated" })
    expect(detailOf(second).parts[messageID(5)]?.[partID(5, 1)]).toBe(detailOf(first).parts[messageID(5)]?.[partID(5, 1)])
    Object.keys(detailOf(first).parts)
      .filter((id) => id !== messageID(5))
      .forEach((id) => expect(detailOf(second).parts[id]).toBe(detailOf(first).parts[id]))
  })
})

describe("client seen id ring", () => {
  test("remembers ids once and evicts in insertion order at capacity", () => {
    const ring = createClientSeenIdRing(3)
    expect(ring.remember("a")).toBe(true)
    expect(ring.remember("a")).toBe(false)
    expect(ring.remember("b")).toBe(true)
    expect(ring.remember("c")).toBe(true)
    expect(ring.size).toBe(3)
    expect(ring.remember("d")).toBe(true)
    expect(ring.has("a")).toBe(false)
    expect(ring.has("b")).toBe(true)
    expect(ring.size).toBe(3)
    expect(ring.remember("a")).toBe(true)
    expect(ring.has("b")).toBe(false)
    ring.clear()
    expect(ring.size).toBe(0)
    expect(ring.has("a")).toBe(false)
    expect(ring.remember("a")).toBe(true)
  })

  test("never exceeds capacity across a long stream", () => {
    const ring = createClientSeenIdRing(64)
    for (let index = 0; index < 10_000; index += 1) expect(ring.remember(`event-${index}`)).toBe(true)
    expect(ring.size).toBe(64)
    expect(ring.has("event-9999")).toBe(true)
    expect(ring.has("event-9936")).toBe(true)
    expect(ring.has("event-9935")).toBe(false)
  })
})

function hydrate() {
  const controller = createClientStateSync({ transport: unusedTransport() })
  const catalog = applyClientStateSnapshot(controller.getState(), stateSnapshot())
  return applyClientSessionSnapshot(catalog, sessionSnapshot("cursor-1", "digest-1"))
}

function apply(state: ClientStateSyncState, event: Event) {
  return applyClientSessionEvent(state, event, createClientSessionEventBuffers()).state
}

function detailOf(state: ClientStateSyncState) {
  const detail = state.sessionDetails["session-1"]
  if (!detail) throw new Error("session-1 detail missing")
  return detail
}

function messageID(index: number) {
  return `message-${index}`
}

function partID(messageIndex: number, partIndex: number) {
  return `part-${messageIndex}-${partIndex}`
}

function part(messageIndex: number, partIndex: number, text = `text-${partIndex}`): Part {
  return {
    id: partID(messageIndex, partIndex),
    sessionID: "session-1",
    messageID: messageID(messageIndex),
    type: "text",
    text,
    // Streaming fixtures must carry `time.start`: a part with no timing never
    // streamed, so the engine treats it as final and drops deltas/overlays.
    time: { start: 1 },
  }
}

function message(index: number): Message {
  return {
    id: messageID(index),
    sessionID: "session-1",
    role: "user",
    time: { created: index },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  }
}

function session(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title: "First",
    version: "test",
    time: { created: 1, updated: 1 },
  }
}

function scope() {
  return { projectID: "project-1", directory: "C:/Work/OpencodeX" }
}

function stateSnapshot(): OpencodeXStateSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor: "cursor-1",
    digest: "digest-1",
    domains: {
      catalog: { revision: "digest-1", digest: "digest-1" },
      operations: { revision: "digest-1", digest: "digest-1" },
    },
    payloads: {
      catalog: {
        projects: [],
        sessionCards: { items: [session("session-1")], hasMore: false, missing: [], sessionUiState: {} },
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

function sessionSnapshot(cursor: string, digest: string): OpencodeXSessionSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor,
    digest,
    session: session("session-1"),
    messages: {
      items: Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
        info: message(index),
        parts: Array.from({ length: PARTS_PER_MESSAGE }, (_, partIndex) => part(index, partIndex)),
      })),
      coverage: { firstMessageID: messageID(0), lastMessageID: messageID(MESSAGE_COUNT - 1) },
      boundary: { hasMore: false },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

function unusedTransport(): ClientStateSyncTransport {
  return {
    snapshot: async () => {
      throw new Error("unused transport")
    },
    session: async () => {
      throw new Error("unused transport")
    },
    events: async () => {
      throw new Error("unused transport")
    },
  }
}
