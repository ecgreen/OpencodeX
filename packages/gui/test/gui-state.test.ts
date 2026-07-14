import { expect, test } from "bun:test"
import type { OpencodeXStateSnapshot, Session } from "@opencode-ai/sdk/v2/client"
import { applyClientStateSnapshot, createClientStateSync, type ClientStateSyncTransport } from "@opencode-ai/sdk/v2/client-sync"
import { reconcileGuiCapabilities } from "../src/renderer/src/lib/capabilities"
import { emptyGuiSnapshot, reconcileGuiAuthoritativeState } from "../src/renderer/src/lib/gui-state"

test("GUI authoritative state adapter initializes root state and preserves capabilities", () => {
  const controller = createClientStateSync({ transport: unusedTransport() })
  const state = applyClientStateSnapshot(controller.getState(), snapshot())
  const current = emptyGuiSnapshot()

  const next = reconcileGuiAuthoritativeState(current, state)

  expect(next?.sessions.map((session) => session.id)).toEqual(["session-1"])
  expect(next?.providers).toBe(current.providers)
  expect(next?.stateRevision).toBe("digest-1")
  expect(reconcileGuiAuthoritativeState(next, state)).toBe(next)
})

test("GUI capabilities adapter updates only changed capability references", () => {
  const current = emptyGuiSnapshot()
  const capabilities = {
    providers: current.providers,
    connectedProviderIDs: ["test"],
    agents: current.agents,
    commands: current.commands,
    lsp: current.lsp,
    mcp: current.mcp,
    config: current.config,
    mcpResources: current.mcpResources,
    plugins: current.plugins,
  }

  const next = reconcileGuiCapabilities(current, capabilities)

  expect(next).not.toBe(current)
  expect(next.projects).toBe(current.projects)
  expect(next.connectedProviderIDs).toEqual(["test"])
  expect(reconcileGuiCapabilities(next, capabilities)).toBe(next)
})

function snapshot(): OpencodeXStateSnapshot {
  return {
    scope: { projectID: "project-1", directory: "C:/Work/OpencodeX" },
    epoch: "epoch-1",
    cursor: "cursor-1",
    digest: "digest-1",
    domains: {
      catalog: { revision: "catalog-1", digest: "catalog-1" },
      operations: { revision: "operations-1", digest: "operations-1" },
    },
    payloads: {
      catalog: {
        projects: [],
        sessions: [session()],
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

function session(): Session {
  return {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title: "Session",
    version: "test",
    time: { created: 1, updated: 1 },
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
