import type { GlobalEvent, Part, QuestionAnswer, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import {
  loadClientSessionSync,
  selectClientSessionMessages,
  updateClientSessionState,
  type ClientStateSyncController,
  type ClientStateSyncState,
  type ClientSessionStateUpdate,
  type ClientSessionSyncResult,
} from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./client"
import { messageCursorBefore } from "./message-window"
import { displayMessageText } from "./message-text"
import { authHeaders } from "./store-auth"
import { isRenderableSession, sessionListQuery, sessionSyncSnapshot } from "./store-session-sync"
import { listPlugins as loadGuiPlugins } from "./store-workbench"
export { authHeaders } from "./store-auth"
export { isRenderableSession } from "./store-session-sync"
export * from "./store-opencodex-actions"
export * from "./store-provider-actions"
import type {
  DiffFile,
  GuiPlugin,
  GuiPluginInstallResult,
  GuiSnapshot,
  MessageBundle,
  PromptPart,
  SessionCardSnapshot,
  SessionData,
  SessionLoadOptions,
  WorkbenchDataResult,
  WorkbenchDiagnostic,
  WorkbenchDiagnosticsResult,
  WorkbenchGitBranches,
  WorkbenchGitFileStatus,
  WorkbenchGitHistoryCommit,
  WorkbenchGitStash,
  WorkbenchGitStatus,
  WorkbenchOperationResult,
} from "./store-types"
export type {
  DiffFile,
  GuiPlugin,
  GuiPluginInstallResult,
  GuiSnapshot,
  MessageBundle,
  PromptPart,
  SessionCardSnapshot,
  SessionData,
  SessionLoadOptions,
  WorkbenchDataResult,
  WorkbenchDiagnostic,
  WorkbenchDiagnosticsResult,
  WorkbenchGitBranches,
  WorkbenchGitFileStatus,
  WorkbenchGitHistoryCommit,
  WorkbenchGitHistoryFile,
  WorkbenchGitStash,
  WorkbenchGitStatus,
  WorkbenchOperationResult,
} from "./store-types"
export {
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  installPlugin,
  listPlugins,
  listWorkbenchFiles,
  readWorkbenchFile,
  registerGuiBridge,
  renameWorkbenchFile,
  togglePlugin,
  workbenchDiagnostics,
  workbenchGithubData,
  workbenchGithubPost,
  workbenchGitBranches,
  workbenchGitDiff,
  workbenchGitHistory,
  workbenchGitOperation,
  workbenchGitStashes,
  workbenchGitStashCreate,
  workbenchGitStashOperation,
  workbenchGitStatus,
  writeWorkbenchFile,
} from "./store-workbench"

const ID_RANDOM_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastClientMessageIDTimestamp = 0
let clientMessageIDCounter = 0

export async function loadSessionCards(gui: GuiClient, since?: string): Promise<ClientSessionSyncResult> {
  return loadClientSessionSync({
    client: gui.client,
    directory: gui.directory || undefined,
    sessionQuery: await sessionListQuery(gui),
    since,
    filterSession: isRenderableSession,
  })
}

export async function loadSnapshot(gui: GuiClient): Promise<GuiSnapshot> {
  const directory = gui.directory || undefined
  const [
    cards,
    providerList,
    configProviders,
    agents,
    commands,
    lsp,
    mcp,
    config,
    mcpResources,
    plugins,
    projects,
    swarms,
    jobs,
  ] = await Promise.all([
    loadSessionCards(gui),
    gui.client.provider
      .list({ directory }, { headers: authHeaders(gui) })
      .then((x) => x.data)
      .catch(() => undefined),
    gui.client.config.providers({ directory }).then((x) => x.data?.providers ?? []),
    gui.client.app.agents({ directory }).then((x) => x.data ?? []),
    Promise.resolve(gui.client.command?.list?.({ directory }))
      .then((x) => x?.data ?? [])
      .catch(() => []),
    Promise.resolve(gui.client.lsp?.status?.({ directory }))
      .then((x) => x?.data ?? [])
      .catch(() => []),
    Promise.resolve(gui.client.mcp?.status?.({ directory }))
      .then((x) => x?.data ?? {})
      .catch(() => ({})),
    Promise.resolve(gui.client.config.get?.({ directory }))
      .then((x) => x?.data)
      .catch(() => undefined),
    Promise.resolve(gui.client.experimental.resource?.list?.({ directory }))
      .then((x) => x?.data ?? {})
      .catch(() => ({})),
    loadGuiPlugins(gui).catch(() => []),
    gui.client.opencodex.project
      .list({ headers: authHeaders(gui) })
      .then((x) => x.data ?? [])
      .catch(() => undefined),
    gui.client.opencodex.swarm.list().then((x) => x.data ?? []),
    gui.client.opencodex.job.list().then((x) => x.data ?? []),
  ])
  const cardSnapshot = sessionSyncSnapshot(cards)

  return {
    ...cardSnapshot,
    projects: projects ?? cardSnapshot.projects,
    sessionSyncRevision: cards.revision,
    providers: providerList?.all ?? configProviders,
    connectedProviderIDs: providerList?.connected ?? [],
    agents,
    commands,
    lsp,
    mcp,
    config,
    mcpResources,
    plugins,
    swarms,
    jobs,
  }
}

export async function updateSessionUiState(gui: GuiClient, sessionID: string, input: ClientSessionStateUpdate) {
  return updateClientSessionState(gui.client, sessionID, input)
}

export async function loadSessionDiff(
  gui: GuiClient,
  input: { sessionID: string; directory?: string; messageID?: string },
) {
  return gui.client.session.diff(
    {
    sessionID: input.sessionID,
    directory: input.directory || gui.directory || undefined,
    messageID: input.messageID,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function loadVcsDiff(
  gui: GuiClient,
  input: { mode: "git" | "branch"; context?: number; directory?: string },
) {
  return gui.client.vcs.diff(
    {
    directory: input.directory || gui.directory || undefined,
    mode: input.mode,
    context: input.context,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function loadSession(
  gui: GuiClient,
  sessionID: string,
  directory?: string,
  options: SessionLoadOptions = {},
): Promise<SessionData> {
  const queryDirectory = directory || gui.directory || undefined
  const [messagePage, todos, diffs] = await Promise.all([
    loadSessionMessages(gui, sessionID, directory, {
      limit: options.messageLimit ?? 200,
      renderBudget: options.messageRenderBudget,
      before: options.messageBefore,
    }),
    options.includeSideData === false
      ? Promise.resolve({ data: [] as Todo[] })
      : gui.client.session.todo({ sessionID, directory: queryDirectory }),
    options.includeSideData === false
      ? Promise.resolve({ data: [] as SnapshotFileDiff[] })
      : gui.client.session.diff({ sessionID, directory: queryDirectory }),
  ])
  return {
    messages: messagePage.messages,
    messageCursor: messagePage.cursor,
    todos: todos.data ?? [],
    diffs: diffs.data ?? [],
  }
}

export async function loadClientStateSession(
  controller: ClientStateSyncController,
  sessionID: string,
  options: { limit?: number; before?: string } = {},
) {
  await controller.hydrateSession(sessionID, options)
  const data = sessionDataFromClientState(controller.getState(), sessionID)
  if (!data) throw new Error(`Authoritative session snapshot missing for ${sessionID}`)
  return data
}

export function sessionDataFromClientState(state: ClientStateSyncState, sessionID: string): SessionData | undefined {
  const detail = state.sessionDetails[sessionID]
  if (!detail) return
  return {
    messages: normalizeMessageText(selectClientSessionMessages(state, sessionID)),
    messageCursor: detail.snapshot.messages.boundary.next,
    todos: detail.snapshot.todos,
    diffs: detail.snapshot.diff,
  }
}

export async function loadSessionMessages(
  gui: GuiClient,
  sessionID: string,
  directory: string | undefined,
  options: { limit: number; renderBudget?: number; before?: string },
) {
  const response = await gui.client.session.messages({
    sessionID,
    directory: directory || gui.directory || undefined,
    limit: options.renderBudget === undefined ? options.limit + 1 : options.limit,
    renderBudget: options.renderBudget,
    before: options.before,
  })
  const messages = normalizeMessageText((response.data ?? []) as MessageBundle[])
  const visible = options.renderBudget === undefined ? messages.slice(-options.limit) : messages
  return {
    messages: visible,
    cursor:
      options.renderBudget === undefined && visible.length < messages.length && visible[0]
        ? messageCursorBefore(visible[0])
        : (response.response?.headers.get("x-next-cursor") ?? undefined),
  }
}

function normalizeMessageText(messages: MessageBundle[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "text" && part.type !== "reasoning") return part
      return { ...part, text: displayMessageText(part.text) } as Part
    }),
  }))
}

export async function sendPrompt(
  gui: GuiClient,
  sessionID: string,
  text: string,
  options: {
    directory?: string
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    parts?: PromptPart[]
  } = {},
) {
  return gui.client.session.promptAsync(
    {
    sessionID,
    directory: options.directory || gui.directory || undefined,
    messageID: createClientMessageID(),
    agent: options.agent,
    model: options.model,
    variant: options.variant,
    parts: options.parts ?? [{ type: "text", text }],
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function runSessionCommand(
  gui: GuiClient,
  sessionID: string,
  input: {
    command: string
    arguments: string
    directory?: string
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    parts?: PromptPart[]
  },
) {
  return gui.client.session.command(
    {
    sessionID,
    command: input.command,
    arguments: input.arguments,
    directory: input.directory || gui.directory || undefined,
    messageID: createClientMessageID(),
    agent: input.agent,
    model: input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined,
    variant: input.variant,
      parts: input.parts?.flatMap((part) => (part.type === "file" ? [part] : [])),
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function runShellCommand(
  gui: GuiClient,
  sessionID: string,
  input: {
    command: string
    directory?: string
    agent?: string
    model?: { providerID: string; modelID: string }
  },
) {
  return gui.client.session.shell(
    {
    sessionID,
    command: input.command,
    directory: input.directory || gui.directory || undefined,
    messageID: createClientMessageID(),
    agent: input.agent,
    model: input.model,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

function createClientMessageID() {
  const timestamp = Date.now()
  const counter = timestamp === lastClientMessageIDTimestamp ? clientMessageIDCounter + 1 : 1
  lastClientMessageIDTimestamp = timestamp
  clientMessageIDCounter = counter
  return `msg_${encodedIDTime(timestamp, counter)}${randomBase62(14)}`
}

function encodedIDTime(timestamp: number, counter: number) {
  const mask = (BigInt(1) << BigInt(48)) - BigInt(1)
  return ((BigInt(timestamp) * BigInt(0x1000) + BigInt(counter)) & mask).toString(16).padStart(12, "0")
}

function randomBase62(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ID_RANDOM_BASE62.charAt(byte % ID_RANDOM_BASE62.length)).join("")
}

export async function abortSession(gui: GuiClient, sessionID: string, directory?: string) {
  return gui.client.session.abort(
    { sessionID, directory: directory || gui.directory || undefined },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function shareSession(gui: GuiClient, sessionID: string) {
  return gui.client.session.share({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function unshareSession(gui: GuiClient, sessionID: string) {
  return gui.client.session.unshare({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function summarizeSession(
  gui: GuiClient,
  input: { sessionID: string; providerID: string; modelID: string },
) {
  return gui.client.session.summarize(input, { headers: authHeaders(gui), throwOnError: true })
}

export async function revertSession(gui: GuiClient, input: { sessionID: string; messageID: string }) {
  return gui.client.session.revert(input, { headers: authHeaders(gui), throwOnError: true })
}

export async function unrevertSession(gui: GuiClient, sessionID: string) {
  return gui.client.session.unrevert({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function forkSession(gui: GuiClient, input: { sessionID: string; messageID?: string }) {
  return gui.client.session.fork(input, { headers: authHeaders(gui), throwOnError: true })
}

export async function replyPermission(
  gui: GuiClient,
  requestID: string,
  reply: "once" | "always" | "reject",
  message?: string,
  directory?: string,
) {
  return gui.client.permission.reply(
    {
    requestID,
    directory: directory || gui.directory || undefined,
    reply,
    message,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function replyQuestion(gui: GuiClient, requestID: string, answers: QuestionAnswer[], directory?: string) {
  return gui.client.question.reply(
    {
    requestID,
    directory: directory || gui.directory || undefined,
    answers,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export async function rejectQuestion(gui: GuiClient, requestID: string, directory?: string) {
  return gui.client.question.reject(
    {
    requestID,
    directory: directory || gui.directory || undefined,
    },
    { headers: authHeaders(gui), throwOnError: true },
  )
}

export function subscribeEvents(gui: GuiClient, onEvent: (event: GlobalEvent) => void) {
  const controller = new AbortController()
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const events = await gui.client.global.event({ signal: controller.signal, sseMaxRetryAttempts: 0 })
        await gui.client.sync.start({ directory: gui.directory || undefined }).catch(() => {})
        for await (const event of events.stream) {
          if (controller.signal.aborted) break
          onEvent(event)
        }
      } catch {
        if (controller.signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }
  })()
  return () => controller.abort()
}
