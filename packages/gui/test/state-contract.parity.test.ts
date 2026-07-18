import { expect, test } from "bun:test"
import type {
  Message,
  OpencodeXSessionSnapshot,
  OpencodeXStateSnapshot,
  Part,
  Session,
} from "@opencode-ai/sdk/v2/client"
import {
  createClientStateSync,
  type ClientCapabilitiesSnapshot,
  type ClientStateSyncState,
  type ClientStateSyncTransport,
} from "@opencode-ai/sdk/v2/client-sync"
import { projectTuiClientState } from "../../opencode/src/cli/cmd/tui/context/sync-state"
import { clientWorkItems } from "@opencode-ai/sdk/v2/work-item"
import { emptyGuiSnapshot, reconcileGuiAuthoritativeState } from "../src/renderer/src/lib/gui-state"
import { sessionDataFromClientState } from "../src/renderer/src/lib/store"

test("GUI and TUI adapters project the same shared root, capabilities, interactions, and transcript", async () => {
  const controller = createClientStateSync({ transport: transport() })
  await controller.start()
  await Promise.all([controller.refreshCapabilities(), controller.hydrateSession("session-1")])
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
    id: "part-delta",
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      field: "text",
      delta: " world",
    },
  })
  controller.applyEvent({
    id: "part-delta",
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      field: "text",
      delta: " duplicated",
    },
  })

  const state = controller.getState()
  const gui = reconcileGuiAuthoritativeState(emptyGuiSnapshot(), state)
  const tui = projectTuiClientState(state)
  const guiSession = sessionDataFromClientState(state, "session-1")

  expect(gui?.sessions.map((item) => item.id)).toEqual(tui?.sessions.map((item) => item.id))
  expect(gui?.sessionStatus).toEqual(tui?.sessionStatus)
  expect(gui?.sessionUiState).toEqual(tui?.sessionUiState)
  expect(gui?.permissions.map((item) => item.id)).toEqual(
    Object.values(tui?.permissions ?? {}).flatMap((requests) => requests.map((item) => item.id)),
  )
  expect(gui?.connectedProviderIDs).toEqual(tui?.capabilities?.providerList.connected)
  expect(gui?.config).toEqual(tui?.capabilities?.config)
  expect(guiSession?.messages).toEqual(tui?.details["session-1"]?.messages)
  expect(guiSession?.messages[0]?.parts[0]).toMatchObject({ text: "hello world" })
  expect(tui?.workItems).toEqual(clientWorkItems(state))
  expect(controller.getMetrics().liveEventDuplicates).toBe(1)
  controller.stop()
})

test("GUI and TUI adapters retain parity for out-of-order parts and interaction resolution", async () => {
  const controller = createClientStateSync({ transport: transport() })
  await controller.start()
  await Promise.all([controller.refreshCapabilities(), controller.hydrateSession("session-1")])

  controller.applyEvent({
    id: "part-before-update",
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-2",
      field: "text",
      delta: " buffered",
    },
  })
  controller.applyEvent({
    id: "part-update",
    type: "message.part.updated",
    properties: {
      part: { ...part(), id: "part-2", text: "arrived" },
    },
  })
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
    id: "question-asked",
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          header: "Choice",
          question: "Continue?",
          options: [{ label: "Yes", description: "Continue the task." }],
        },
      ],
    },
  })

  expectClientParity(controller.getState())
  expect(sessionDataFromClientState(controller.getState(), "session-1")?.messages[0]?.parts[1]).toMatchObject({
    text: "arrived buffered",
  })

  controller.applyEvent({
    id: "permission-replied",
    type: "permission.replied",
    properties: { sessionID: "session-1", requestID: "permission-1", reply: "once" },
  })
  controller.applyEvent({
    id: "question-replied",
    type: "question.replied",
    properties: { sessionID: "session-1", requestID: "question-1", answers: [["Yes"]] },
  })

  expectClientParity(controller.getState())
  expect(reconcileGuiAuthoritativeState(emptyGuiSnapshot(), controller.getState())?.permissions).toEqual([])
  expect(reconcileGuiAuthoritativeState(emptyGuiSnapshot(), controller.getState())?.questions).toEqual([])
  controller.stop()
})

test("GUI and TUI adapters retain parity across transcript paging and deletion", async () => {
  const controller = createClientStateSync({ transport: pagedTransport() })
  await controller.start()
  await Promise.all([controller.refreshCapabilities(), controller.hydrateSession("session-1")])
  await controller.hydrateSession("session-1", { before: "message-1" })

  expectClientParity(controller.getState())
  expect(sessionDataFromClientState(controller.getState(), "session-1")?.messages.map((item) => item.info.id)).toEqual([
    "message-0",
    "message-1",
  ])

  controller.applyEvent({
    id: "session-deleted",
    type: "session.deleted",
    properties: { sessionID: "session-1", info: session() },
  })

  expectClientParity(controller.getState())
  expect(sessionDataFromClientState(controller.getState(), "session-1")).toBeUndefined()
  expect(controller.getState().tombstones.sessions["session-1"]).toBe(true)
  controller.stop()
})

test("GUI and TUI adapters retain parity after event-before-snapshot replay and reconnect", async () => {
  let releaseSnapshot = () => {}
  let snapshots = 0
  let connections = 0
  const transport: ClientStateSyncTransport = {
    snapshot: async () => {
      snapshots += 1
      if (snapshots === 1) await new Promise<void>((resolve) => (releaseSnapshot = resolve))
      return rootSnapshot()
    },
    session: async () => sessionSnapshot(),
    capabilities: async () => capabilities(),
    events: async ({ signal }) => {
      connections += 1
      if (connections === 1)
        return (async function* () {
          yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
          yield stateEvent("cursor-2", "catalog", "session-1", 0)
        })()
      return (async function* () {
        yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-2" }
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      })()
    },
  }
  const controller = createClientStateSync({ transport, batchMs: 0, reconnectDelayMs: 0 })
  const starting = controller.start()
  await Bun.sleep(0)
  releaseSnapshot()
  await starting
  await controller.refreshCapabilities()
  await waitFor(() => snapshots === 2 && connections === 2)

  expectClientParity(controller.getState())
  expect(controller.getState().cursor).toBe("cursor-2")
  expect(controller.getMetrics()).toMatchObject({ rootSnapshots: 2, streamConnections: 2, reconnects: 1 })
  controller.stop()
})

test("GUI and TUI adapters retain parity after a retention reset replaces canonical state", async () => {
  let connections = 0
  let snapshots = 0
  const transport: ClientStateSyncTransport = {
    snapshot: async () => {
      snapshots += 1
      if (snapshots === 1) return rootSnapshot()
      const replacement = { ...session(), id: "session-2", slug: "session-2", title: "Replacement" }
      return {
        ...rootSnapshot(),
        epoch: "epoch-2",
        cursor: "cursor-3",
        digest: "root-2",
        domains: {
          catalog: { revision: "catalog-2", digest: "catalog-2" },
          operations: { revision: "operations-2", digest: "operations-2" },
        },
        payloads: {
          ...rootSnapshot().payloads,
          catalog: {
            ...rootSnapshot().payloads.catalog,
            sessions: [replacement],
            sessionStatus: { "session-2": { type: "idle" } },
          },
        },
      }
    },
    session: async () => sessionSnapshot(),
    capabilities: async () => capabilities(),
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
        if (connection === 1)
          yield {
            type: "reset_required",
            scope: scope(),
            epoch: "epoch-1",
            cursor: "cursor-2",
            reason: "cursor is not retained",
          }
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      })()
    },
  }
  const controller = createClientStateSync({ transport, batchMs: 0, reconnectDelayMs: 1 })
  await controller.start()
  await waitFor(() => controller.getMetrics().resets === 1 && controller.getState().epoch === "epoch-2")
  await controller.refreshCapabilities()

  expectClientParity(controller.getState())
  expect(controller.getState().sessions.ids).toEqual(["session-2"])
  expect(controller.getMetrics()).toMatchObject({ resets: 1, streamConnections: 2, rootSnapshots: 2 })
  controller.stop()
})

function transport(): ClientStateSyncTransport {
  return {
    snapshot: async () => rootSnapshot(),
    session: async () => sessionSnapshot(),
    capabilities: async () => capabilities(),
    events: async ({ signal }) =>
      (async function* () {
        yield { type: "ready", scope: scope(), epoch: "epoch-1", cursor: "cursor-1" }
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      })(),
  }
}

function pagedTransport(): ClientStateSyncTransport {
  return {
    ...transport(),
    session: async (input) => (input.before ? olderSessionSnapshot() : sessionSnapshot()),
  }
}

function expectClientParity(state: ClientStateSyncState) {
  const gui = reconcileGuiAuthoritativeState(emptyGuiSnapshot(), state)
  const tui = projectTuiClientState(state)
  expect(gui?.projects).toEqual(tui?.projects)
  expect(gui?.sessions).toEqual(tui?.sessions)
  expect(gui?.views).toEqual(tui?.views)
  expect(gui?.sessionStatus).toEqual(tui?.sessionStatus)
  expect(gui?.sessionUiState).toEqual(tui?.sessionUiState)
  expect(gui?.permissions).toEqual(Object.values(tui?.permissions ?? {}).flat())
  expect(gui?.questions).toEqual(Object.values(tui?.questions ?? {}).flat())
  expect(gui?.connectedProviderIDs).toEqual(tui?.capabilities?.providerList.connected)
  expect(gui?.config).toEqual(tui?.capabilities?.config)
  state.sessions.ids.forEach((sessionID) => {
    expect(sessionDataFromClientState(state, sessionID)?.messages).toEqual(tui?.details[sessionID]?.messages)
  })
}

function stateEvent(
  cursor: string,
  domain: "capabilities" | "catalog" | "operations" | "session",
  aggregateID: string,
  aggregateSequence: number,
) {
  return {
    type: "event" as const,
    event: {
      id: `${domain}-${cursor}`,
      scope: scope(),
      epoch: "epoch-1",
      cursor,
      aggregateSequence,
      domain,
      operation: "invalidate" as const,
      payload: { aggregateID, eventType: "session.updated" },
    },
  }
}

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 100 })) {
    if (predicate()) return
    await Bun.sleep(2)
  }
  throw new Error("Timed out waiting for state-contract fixture")
}

function rootSnapshot(): OpencodeXStateSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor: "cursor-1",
    digest: "root-1",
    domains: {
      catalog: { revision: "catalog-1", digest: "catalog-1" },
      operations: { revision: "operations-1", digest: "operations-1" },
    },
    payloads: {
      catalog: {
        projects: [],
        sessions: [session()],
        views: [],
        sessionStatus: { "session-1": { type: "busy" } },
        permissions: [],
        questions: [],
        sessionUiState: {},
      },
      operations: { jobs: [], swarms: [] },
    },
  }
}

function sessionSnapshot(): OpencodeXSessionSnapshot {
  return {
    scope: scope(),
    epoch: "epoch-1",
    cursor: "cursor-1",
    digest: "session-1",
    session: session(),
    messages: {
      items: [{ info: message(), parts: [part()] }],
      coverage: { firstMessageID: "message-1", lastMessageID: "message-1" },
      boundary: { hasMore: false },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

function olderSessionSnapshot(): OpencodeXSessionSnapshot {
  return {
    ...sessionSnapshot(),
    digest: "session-older",
    messages: {
      items: [
        {
          info: { ...message(), id: "message-0", time: { created: 0 } },
          parts: [{ ...part(), id: "part-0", messageID: "message-0", text: "older" }],
        },
      ],
      coverage: { firstMessageID: "message-0", lastMessageID: "message-0" },
      boundary: { hasMore: false },
    },
  }
}

function capabilities(): ClientCapabilitiesSnapshot {
  return {
    revision: "capabilities-1",
    providers: [],
    connectedProviderIDs: ["anthropic"],
    providerDefaults: { anthropic: "claude" },
    agents: [],
    commands: [],
    lsp: [],
    mcp: {},
    config: { model: "anthropic/claude" },
    mcpResources: {},
    plugins: [],
    formatter: [],
  }
}

function scope() {
  return { projectID: "project-1", directory: "C:/Work/OpencodeX" }
}

function session(): Session {
  return {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title: "Session",
    version: "test",
    time: { created: 1, updated: 2 },
  }
}

function message(): Message {
  return {
    id: "message-1",
    sessionID: "session-1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude" },
  }
}

function part(): Part {
  return {
    id: "part-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "text",
    text: "hello",
  }
}
