import { describe, expect, test } from "bun:test"
import {
  createClientStateSync,
  type ClientStateSyncState,
  type ClientStateSyncTransport,
} from "@opencode-ai/sdk/v2/client-sync"
import { createSignal } from "solid-js"
import { createAuthoritativeStateApplicator } from "../src/renderer/src/controllers/authoritative-state-applicator"
import { emptyGuiSnapshot } from "../src/renderer/src/lib/gui-state"
import type { SessionData } from "../src/renderer/src/lib/store"

describe("GUI authoritative state applicator", () => {
  test("preserves the rendered snapshot and session caches while canonical state resets", () => {
    const base = emptyState()
    const current: ClientStateSyncState = {
      ...base,
      phase: "ready",
      lifecycle: { status: "connected", data: "current", attempt: 0 },
      scope: { projectID: "project-1", directory: "C:/Work/OpencodeX" },
      epoch: "epoch-1",
      cursor: "cursor-1",
      digest: "digest-1",
    }
    const resetting: ClientStateSyncState = {
      ...base,
      phase: "resetting",
      lifecycle: { status: "resetting", data: "empty", attempt: 0 },
    }
    const retained: SessionData = { messages: [], todos: [], diffs: [] }
    const rendered = { ...emptyGuiSnapshot(), stateRevision: "digest-1" }
    const selected = { "session-1": { data: retained, loadedTime: 1 } }
    const views = { "session-1": retained }
    const [state, setState] = createSignal<ClientStateSyncState | undefined>(current)
    const [snapshot, setSnapshot] = createSignal(rendered)
    const [loading, setLoading] = createSignal("visible")
    const [error, setError] = createSignal<string>()
    const [selectedData, setSelectedData] = createSignal(selected)
    const [activeData, setActiveData] = createSignal(retained)
    const [viewData, setViewData] = createSignal(views)
    const [recentModels, setRecentModels] = createSignal<string[]>([])
    let presentations = 0
    let activeLoadedTime = 1
    const viewLoadedTimes = new Map([["session-1", 1]])
    const apply = createAuthoritativeStateApplicator({
      state,
      setState,
      snapshot,
      setSnapshot,
      setLoading,
      setError,
      reconcilePresentation: () => {
        presentations += 1
      },
      selectedData,
      setSelectedData,
      activeSessionID: () => "session-1",
      activeData,
      setActiveData,
      activeLoadedTime: () => activeLoadedTime,
      setActiveLoadedTime: (time) => {
        activeLoadedTime = time
      },
      rememberActiveData: () => {},
      viewData,
      setViewData,
      viewLoadedTime: (sessionID) => viewLoadedTimes.get(sessionID),
      setViewLoadedTime: (sessionID, loadedTime) => viewLoadedTimes.set(sessionID, loadedTime),
      appliedVersions: new Map(),
      recentModels,
      setRecentModels,
      metrics: () => undefined,
      retention: () => ({}),
    })

    apply(resetting)

    expect(state()).toBe(resetting)
    expect(snapshot()).toBe(rendered)
    expect(selectedData()).toBe(selected)
    expect(activeData()).toBe(retained)
    expect(viewData()).toBe(views)
    expect(loading()).toBe("visible")
    expect(error()).toBeUndefined()
    expect(presentations).toBe(0)

    const replacement = { ...current, digest: "digest-2" }
    apply(replacement)

    expect(state()).toBe(replacement)
    expect(snapshot()).not.toBe(rendered)
    expect(snapshot().stateRevision).toBe("digest-2")
    expect(presentations).toBe(1)
  })
})

function emptyState() {
  const unavailable = async () => Promise.reject(new Error("unused"))
  const transport = {
    snapshot: unavailable,
    session: unavailable,
    events: unavailable,
  } as unknown as ClientStateSyncTransport
  return createClientStateSync({ transport }).getState()
}
