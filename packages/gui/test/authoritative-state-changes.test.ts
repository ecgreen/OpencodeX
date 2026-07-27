import { describe, expect, test } from "bun:test"
import { createClientStateSync, type ClientStateSyncTransport } from "@opencode-ai/sdk/v2/client-sync"
import { authoritativeStateChanges } from "../src/renderer/src/lib/authoritative-state-changes"

describe("GUI authoritative state change classification", () => {
  test("keeps session-detail commits out of root domains", () => {
    const current = emptyState()
    const next = { ...current, sessionDetails: { session: {} as never } }

    expect(authoritativeStateChanges(current, next)).toEqual({
      catalog: false,
      operations: false,
      capabilities: false,
      presentation: false,
      details: true,
    })
  })

  test("classifies independent root domains by reference", () => {
    const current = emptyState()

    expect(authoritativeStateChanges(current, { ...current, jobs: { ids: [], records: {} } }).operations).toBe(true)
    expect(authoritativeStateChanges(current, { ...current, sessions: { ids: [], records: {} } })).toMatchObject({
      catalog: true,
      presentation: true,
      operations: false,
      details: false,
    })
    expect(authoritativeStateChanges(current, { ...current, capabilities: {} as never }).capabilities).toBe(true)
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
