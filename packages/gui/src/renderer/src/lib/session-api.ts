import type { GlobalEvent, QuestionAnswer, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import { updateClientSessionState, type ClientSessionStateUpdate } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./client"
import { messageCursorBefore } from "./message-window"
import { normalizeMessageText } from "./session-data-projection"
import { authHeaders } from "./store-auth"
export { authHeaders } from "./store-auth"
export { sessionDataFromClientState, sessionDataFromSnapshot } from "./session-data-projection"
export {
  fetchClientStateSessionPage,
  loadClientStateSessionTranscript,
  refreshClientStateSessionTail,
} from "./client-session-loader"
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
  WorkbenchCompletionItem,
  WorkbenchCompletionResult,
  WorkbenchDefinitionLocation,
  WorkbenchDiagnostic,
  WorkbenchDiagnosticsResult,
  WorkbenchFileDiagnosticsResult,
  WorkbenchGitBranches,
  WorkbenchHoverResult,
  WorkbenchChangeFile,
  WorkbenchChangeNode,
  WorkbenchChangePatch,
  WorkbenchChangeMetricsPage,
  WorkbenchChangePatchPage,
  WorkbenchChangesPage,
  WorkbenchGitHistoryCommit,
  WorkbenchGitStash,
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
  WorkbenchCompletionItem,
  WorkbenchCompletionResult,
  WorkbenchDefinitionLocation,
  WorkbenchDiagnostic,
  WorkbenchDiagnosticsResult,
  WorkbenchFileDiagnosticsResult,
  WorkbenchFileReadResult,
  WorkbenchGitBranches,
  WorkbenchHoverResult,
  WorkbenchChangeFile,
  WorkbenchChangeNode,
  WorkbenchChangePatch,
  WorkbenchChangeMetricsPage,
  WorkbenchChangePatchPage,
  WorkbenchChangesPage,
  WorkbenchGitHistoryCommit,
  WorkbenchGitHistoryFile,
  WorkbenchGitStash,
  WorkbenchOperationResult,
} from "./store-types"

export type PromptDelivery = "queue" | "direct"
export {
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  initializeWorkbenchGit,
  installPlugin,
  listPlugins,
  listWorkbenchFiles,
  readWorkbenchFile,
  readWorkbenchTextFile,
  renameWorkbenchFile,
  togglePlugin,
  workbenchDiagnostics,
  workbenchFileDefinition,
  workbenchFileCompletion,
  workbenchFileHover,
  workbenchFileDiagnostics,
  workbenchGithubData,
  workbenchGithubPost,
  workbenchGitBranches,
  workbenchChangePatch,
  workbenchChangeMetricsPage,
  workbenchChangePatchPage,
  workbenchChanges,
  workbenchGitHistory,
  workbenchGitOperation,
  workbenchGitStashes,
  workbenchGitStashCreate,
  workbenchGitStashOperation,
  writeWorkbenchFile,
} from "./store-workbench"

const ID_RANDOM_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastClientMessageIDTimestamp = 0
let clientMessageIDCounter = 0

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
    delivery?: PromptDelivery
  } = {},
) {
  return gui.client.session.promptAsync(
    {
      sessionID,
      directory: options.directory || gui.directory || undefined,
      messageID: createClientMessageID(),
      delivery: options.delivery === "direct" ? "immediate" : options.delivery === "queue" ? "deferred" : undefined,
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
    delivery?: PromptDelivery
  },
) {
  return gui.client.session.command(
    {
      sessionID,
      command: input.command,
      arguments: input.arguments,
      directory: input.directory || gui.directory || undefined,
      messageID: createClientMessageID(),
      delivery: input.delivery === "direct" ? "immediate" : input.delivery === "queue" ? "deferred" : undefined,
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
    delivery?: PromptDelivery
  },
) {
  return gui.client.session.shell(
    {
      sessionID,
      command: input.command,
      directory: input.directory || gui.directory || undefined,
      messageID: createClientMessageID(),
      delivery: input.delivery === "direct" ? "immediate" : input.delivery === "queue" ? "deferred" : undefined,
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

export function subscribeEvents(
  gui: GuiClient,
  onEvent: (event: GlobalEvent) => void,
  options: { retryDelayMs?: number; maxRetryDelayMs?: number } = {},
) {
  const controller = new AbortController()
  void (async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      try {
        const events = await gui.client.global.event({ signal: controller.signal, sseMaxRetryAttempts: 0 })
        const started = await gui.client.sync.start({ directory: gui.directory || undefined })
        if (started.error || started.data !== true) throw new Error("Workspace sync failed to start")
        attempt = 0
        for await (const event of events.stream) {
          if (controller.signal.aborted) break
          onEvent(event)
        }
      } catch {
        if (controller.signal.aborted) break
      }
      if (controller.signal.aborted) break
      attempt += 1
      await abortableDelay(
        Math.min(options.maxRetryDelayMs ?? 30_000, (options.retryDelayMs ?? 1_000) * 2 ** (attempt - 1)),
        controller.signal,
      )
    }
  })()
  return () => controller.abort()
}

function abortableDelay(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
  })
}
