import { expect, test } from "bun:test"
import type {
  Message,
  OpencodeXSessionSnapshot,
  OpencodeXSessionUiState,
  OpencodeXStateSnapshot,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client"
import {
  applyClientStateSnapshot,
  clientPlanModeSwitch,
  createClientStateSync,
  type ClientCapabilitiesSnapshot,
  type ClientDerivedSessionStatus,
  type ClientStateSyncState,
  type ClientStateSyncTransport,
} from "@opencode-ai/sdk/v2/client-sync"
import { projectTuiClientState } from "../../opencode/src/cli/cmd/tui/context/sync-state"
import { deriveStatus as deriveTuiStatus } from "../../opencode/src/cli/cmd/tui/component/opencodex-session-status-core"
import { clientWorkItems } from "@opencode-ai/sdk/v2/work-item"
import { emptyGuiSnapshot, reconcileGuiAuthoritativeState } from "../src/renderer/src/lib/gui-state"
import { deriveSessionStatus } from "../src/renderer/src/lib/session-status"
import { sessionDataFromClientState } from "../src/renderer/src/lib/session-api"

const HARMONY_ENVELOPE = JSON.stringify({ channel: "final", content: "done" })
const REMINDER_TEXT = "keep this\n<system-reminder>drop this</system-reminder>"

test("GUI and TUI adapters project the same shared root, capabilities, interactions, and transcript", async () => {
  const controller = createClientStateSync({ transport: transport() })
  await controller.start()
  await Promise.all([controller.refreshCapabilities(), controller.refreshSessionTail("session-1")])
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

test("GUI session projection preserves unchanged presentation identities", async () => {
  const controller = createClientStateSync({ transport: pagedTransport() })
  await controller.start()
  await controller.refreshSessionTail("session-1")
  await controller.loadOlderSessionPage("session-1", { before: "message-1" })
  const first = sessionDataFromClientState(controller.getState(), "session-1")
  const second = sessionDataFromClientState(controller.getState(), "session-1", first)

  expect(second).toBe(first)
  expect(second?.messages[0]).toBe(first?.messages[0])
  expect(second?.messages[0]?.parts[0]).toBe(first?.messages[0]?.parts[0])

  controller.applyEvent({
    id: "identity-delta",
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID: "message-1",
      partID: "part-1",
      field: "text",
      delta: " world",
    },
  })
  const updated = sessionDataFromClientState(controller.getState(), "session-1", first)
  expect(updated).not.toBe(first)
  expect(updated?.messages[0]).toBe(first?.messages[0])
  expect(updated?.messages[1]).not.toBe(first?.messages[1])
  expect(updated?.messages[1]?.parts[0]).toMatchObject({ text: "hello world" })
  controller.stop()
})

test("GUI and TUI retain assignment IDs and cards omitted by later root pages", () => {
  const controller = createClientStateSync({ transport: transport() })
  const firstSnapshot = rootSnapshot()
  firstSnapshot.payloads.catalog.projects = [
    {
      id: "overlay-1",
      project: {
        id: "project-1",
        worktree: "C:/Work/OpencodeX",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      },
      folders: [],
      sessionIDs: ["session-1", "old-associated"],
    },
  ]
  const first = applyClientStateSnapshot(controller.getState(), firstSnapshot)
  const refresh = rootSnapshot()
  refresh.cursor = "cursor-2"
  refresh.digest = "root-2"
  refresh.domains.catalog = { revision: "catalog-2", digest: "catalog-2" }
  refresh.payloads.catalog.projects = firstSnapshot.payloads.catalog.projects
  refresh.payloads.catalog.sessionCards = { items: [], hasMore: false, missing: [], sessionUiState: {} }
  const second = applyClientStateSnapshot(first, refresh)
  const gui = reconcileGuiAuthoritativeState(emptyGuiSnapshot(), second)
  const tui = projectTuiClientState(second)

  expect(second.sessions.records["session-1"]).toBe(first.sessions.records["session-1"])
  expect(gui?.projects[0]?.sessionIDs).toEqual(["session-1", "old-associated"])
  expect(tui?.projects[0]?.sessionIDs).toEqual(gui?.projects[0]?.sessionIDs)
  expect(gui?.projects[0]?.sessions.map((item) => item.id)).toEqual(["session-1"])
  expect(tui?.projects[0]?.sessions.map((item) => item.id)).toEqual(["session-1"])
})

test("GUI and TUI adapters retain parity for out-of-order parts and interaction resolution", async () => {
  const controller = createClientStateSync({ transport: transport() })
  await controller.start()
  await Promise.all([controller.refreshCapabilities(), controller.refreshSessionTail("session-1")])

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
      // `time.start` marks the part as streaming; buffered deltas are dropped
      // for timeless parts, which never streamed and are final.
      part: { ...part(), id: "part-2", text: "arrived", time: { start: 1 } },
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
  await Promise.all([controller.refreshCapabilities(), controller.refreshSessionTail("session-1")])
  await controller.loadOlderSessionPage("session-1", { before: "message-1" })

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
  await waitFor(() => snapshots >= 2 && connections >= 2)

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
            sessionCards: { items: [replacement], hasMore: false, missing: [], sessionUiState: {} },
            sessionStatus: { "session-2": { type: "idle" } },
          },
        },
      }
    },
    session: async () => sessionSnapshot(),
    capabilities: async () => capabilities("epoch-2"),
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

test("GUI and TUI render the same display text, raw while streaming and normalized once complete", async () => {
  const controller = createClientStateSync({ transport: envelopeTransport() })
  await controller.start()
  await controller.refreshSessionTail("session-1")

  const streaming = controller.getState()
  expect(guiParts(streaming)).toEqual(tuiParts(streaming))
  expect(guiParts(streaming).map((part) => part.text)).toEqual([HARMONY_ENVELOPE, REMINDER_TEXT])

  completeEnvelopeParts(controller)

  const complete = controller.getState()
  expect(guiParts(complete)).toEqual(tuiParts(complete))
  expect(guiParts(complete).map((part) => part.text)).toEqual(["done", REMINDER_TEXT])
  controller.stop()
})

test("GUI and TUI adapters derive the same session status from the shared core", () => {
  const now = 1_000_000_000
  const stale = now - 20 * 60 * 1000
  const cases: {
    name: string
    expected: ClientDerivedSessionStatus
    updated?: number
    status?: SessionStatus
    uiState?: OpencodeXSessionUiState
    permissions?: PermissionRequest[]
    questions?: QuestionRequest[]
    pendingPrompt?: boolean
    incompleteTurn?: boolean
  }[] = [
    { name: "idle", expected: "dormant" },
    { name: "permission wins over everything", expected: "input_needed", permissions: [statusPermission()], status: { type: "busy" } },
    { name: "question", expected: "input_needed", questions: [statusQuestion()] },
    { name: "persisted input_needed", expected: "input_needed", uiState: statusUiState("input_needed") },
    { name: "backend busy", expected: "in_progress", status: { type: "busy" } },
    { name: "backend retry", expected: "in_progress", status: { type: "retry", attempt: 1, message: "retrying", next: 1 } },
    { name: "optimistic pending prompt", expected: "in_progress", pendingPrompt: true },
    { name: "persisted in_progress", expected: "in_progress", uiState: statusUiState("in_progress") },
    { name: "recent incomplete turn", expected: "in_progress", incompleteTurn: true, updated: now - 60_000 },
    {
      name: "incomplete turn stale past the activity window",
      expected: "dormant",
      incompleteTurn: true,
      updated: stale,
    },
    {
      name: "stale incomplete turn still falls back to needs_review",
      expected: "needs_review",
      incompleteTurn: true,
      updated: stale,
      uiState: statusUiState("needs_review", true),
    },
    { name: "needs_review while unseen", expected: "needs_review", uiState: statusUiState("needs_review", true) },
    { name: "needs_review gated by updated:false", expected: "dormant", uiState: statusUiState("needs_review", false) },
  ]

  cases.forEach((item) => {
    const session = statusSession(item.updated ?? now - 60_000)
    const messages = item.incompleteTurn ? [incompleteAssistantTurn()] : []
    const snapshot = {
      ...emptyGuiSnapshot(),
      sessions: [session],
      sessionStatus: item.status ? { [session.id]: item.status } : {},
      sessionUiState: item.uiState ? { [session.id]: item.uiState } : {},
      sessionPendingPrompt: item.pendingPrompt ? { [session.id]: true } : {},
      permissions: item.permissions ?? [],
      questions: item.questions ?? [],
    }
    const gui = deriveSessionStatus(snapshot, session, { messages, now })
    const tui = deriveTuiStatus(session.id, tuiStatusSync(snapshot, messages), now)

    expect(tui, item.name).toBe(item.expected)
    expect(gui, item.name).toBe(item.expected === "needs_review" ? "ready_for_review" : item.expected)
  })
})

test("clientPlanModeSwitch classifies only completed plan tool calls", () => {
  expect(clientPlanModeSwitch(planEvent("plan_enter", "completed"))).toEqual({
    sessionID: "session-1",
    partID: "part-plan",
    agent: "plan",
  })
  expect(clientPlanModeSwitch(planEvent("plan_exit", "completed"))).toEqual({
    sessionID: "session-1",
    partID: "part-plan",
    agent: "build",
  })
  expect(clientPlanModeSwitch(planEvent("plan_enter", "running"))).toBeUndefined()
  expect(clientPlanModeSwitch(planEvent("bash", "completed"))).toBeUndefined()
  expect(
    clientPlanModeSwitch({ id: "other", type: "session.idle", properties: { sessionID: "session-1" } }),
  ).toBeUndefined()
})

function guiParts(state: ClientStateSyncState) {
  return (sessionDataFromClientState(state, "session-1")?.messages.at(-1)?.parts ?? []) as { text: string }[]
}

function tuiParts(state: ClientStateSyncState) {
  return (projectTuiClientState(state)?.details["session-1"]?.messages.at(-1)?.parts ?? []) as { text: string }[]
}

function completeEnvelopeParts(controller: ReturnType<typeof createClientStateSync>) {
  envelopeParts().forEach((part) => {
    controller.applyEvent({
      id: `complete-${part.id}`,
      type: "message.part.updated",
      properties: { part: { ...part, time: { start: 1, end: 2 } } },
    })
  })
}

function envelopeParts(): Part[] {
  return [
    {
      id: "part-envelope",
      sessionID: "session-1",
      messageID: "message-envelope",
      type: "text",
      text: HARMONY_ENVELOPE,
      time: { start: 1 },
    },
    {
      id: "part-reminder",
      sessionID: "session-1",
      messageID: "message-envelope",
      type: "text",
      text: REMINDER_TEXT,
      time: { start: 1 },
    },
  ]
}

function envelopeTransport(): ClientStateSyncTransport {
  return {
    ...transport(),
    session: async () => ({
      ...sessionSnapshot(),
      digest: "session-envelope",
      messages: {
        items: [
          {
            info: { ...message(), id: "message-envelope", role: "assistant", time: { created: 2, completed: 3 } },
            parts: envelopeParts(),
          },
        ],
        coverage: { firstMessageID: "message-envelope", lastMessageID: "message-envelope" },
        boundary: { hasMore: false },
      },
    }),
  }
}

function planEvent(tool: string, status: "completed" | "running") {
  return {
    id: "plan-part",
    type: "message.part.updated" as const,
    properties: {
      part: {
        id: "part-plan",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool" as const,
        tool,
        callID: "call-1",
        state:
          status === "completed"
            ? { status, input: {}, output: "", title: tool, metadata: {}, time: { start: 1, end: 2 } }
            : { status, input: {}, time: { start: 1 } },
      },
    },
  }
}

function statusSession(updated: number): Session {
  return { ...session(), time: { created: 1, updated } }
}

function statusUiState(
  displayStatus: NonNullable<OpencodeXSessionUiState["displayStatus"]>,
  updated?: boolean,
): OpencodeXSessionUiState {
  return {
    sessionID: "session-1",
    reviewedAt: 1,
    reviewedFiles: [],
    displayStatus,
    ...(updated === undefined ? {} : { updated }),
  }
}

function statusPermission(): PermissionRequest {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: [],
  }
}

function statusQuestion(): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [{ header: "Choice", question: "Continue?", options: [{ label: "Yes", description: "Go on." }] }],
  }
}

function incompleteAssistantTurn() {
  return {
    info: {
      id: "message-turn",
      sessionID: "session-1",
      role: "assistant" as const,
      time: { created: 1 },
      system: [],
      modelID: "claude",
      providerID: "anthropic",
      mode: "build",
      path: { cwd: "C:/Work/OpencodeX", root: "C:/Work/OpencodeX" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ id: "part-step", sessionID: "session-1", messageID: "message-turn", type: "step-start" as const }],
  }
}

function tuiStatusSync(snapshot: ReturnType<typeof emptyGuiSnapshot>, messages: ReturnType<typeof incompleteAssistantTurn>[]) {
  return {
    data: {
      permission: groupBySessionID(snapshot.permissions),
      question: groupBySessionID(snapshot.questions),
      session: snapshot.sessions,
      session_status: snapshot.sessionStatus,
      session_ui_state: snapshot.sessionUiState,
      session_pending_prompt: snapshot.sessionPendingPrompt ?? {},
      message: messages.length > 0 ? { "session-1": messages.map((item) => item.info) } : {},
      part: Object.fromEntries(messages.map((item) => [item.info.id, item.parts])),
    },
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the TUI adapter only reads these slices
  } as unknown as Parameters<typeof deriveTuiStatus>[1]
}

function groupBySessionID<T extends { sessionID: string }>(items: readonly T[]) {
  return items.reduce<Record<string, T[]>>(
    (result, item) => ({ ...result, [item.sessionID]: [...(result[item.sessionID] ?? []), item] }),
    {},
  )
}

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
      position: Number(cursor.replace(/\D/g, "")) || 1,
      visibility: "global" as const,
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
        sessionCards: { items: [session()], hasMore: false, missing: [], sessionUiState: {} },
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

function capabilities(epoch = "epoch-1"): ClientCapabilitiesSnapshot {
  return {
    scope: scope(),
    epoch,
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
