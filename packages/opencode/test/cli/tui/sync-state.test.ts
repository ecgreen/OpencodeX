import { expect, test } from "bun:test"
import type { Message, OpencodeXSessionSnapshot, OpencodeXStateSnapshot, Part, Session } from "@opencode-ai/sdk/v2"
import {
  applyClientSessionSnapshot,
  applyClientStateSnapshot,
  createClientStateSync,
  type ClientStateSyncTransport,
} from "@opencode-ai/sdk/v2"
import { projectTuiClientState } from "@tui/context/sync-state"

test("projects authoritative catalog, interactions, and loaded session details for the TUI adapter", () => {
  const controller = createClientStateSync({ transport: unusedTransport() })
  const state = applyClientSessionSnapshot(
    applyClientStateSnapshot(controller.getState(), rootSnapshot()),
    sessionSnapshot(),
  )
  const projection = projectTuiClientState({
    ...state,
    capabilities: {
      revision: "capabilities-1",
      providers: [],
      connectedProviderIDs: ["anthropic"],
      providerDefaults: { anthropic: "claude" },
      agents: [],
      commands: [],
      lsp: [],
      mcp: {},
      config: {},
      mcpResources: {},
      plugins: [],
      formatter: [],
    },
  })

  expect(projection?.revision).toBe("root-1")
  expect(projection?.sessions.map((item) => item.id)).toEqual(["session-1"])
  expect(projection?.permissions["session-1"]?.map((item) => item.id)).toEqual(["permission-1"])
  expect(projection?.capabilities?.providerList).toEqual({
    all: [],
    connected: ["anthropic"],
    default: { anthropic: "claude" },
  })
  expect(projection?.details["session-1"]).toMatchObject({
    version: "epoch-1:1",
    todos: [{ content: "Review", status: "pending", priority: "high" }],
    messages: [{ info: { id: "message-1" }, parts: [{ id: "part-1", text: "hello" }] }],
  })
})

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
        sessionCards: {
          items: [session()],
          hasMore: false,
          missing: [],
          sessionUiState: {
            "session-1": {
              sessionID: "session-1",
              reviewedFiles: [],
              displayStatus: "input_needed",
              updated: true,
            },
          },
        },
        views: [],
        sessionStatus: { "session-1": { type: "busy" } },
        permissions: [
          {
            id: "permission-1",
            sessionID: "session-1",
            permission: "edit",
            patterns: ["src/**"],
            metadata: {},
            always: [],
          },
        ],
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
    todos: [{ content: "Review", status: "pending", priority: "high" }],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
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
    title: "First",
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
    model: { providerID: "test", modelID: "test" },
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
