import type {
  Agent,
  GlobalEvent,
  Message,
  OpencodeXJob,
  OpencodeXProject,
  OpencodeXSessionUiState,
  OpencodeXSwarm,
  OpencodeXSwarmRoleInput,
  OpencodeXView,
  Part,
  PermissionRequest,
  Provider,
  QuestionAnswer,
  QuestionRequest,
  SnapshotFileDiff,
  Session,
  SessionStatus,
  Todo,
  VcsFileDiff,
} from "@opencode-ai/sdk/v2/client"
import {
  isRenderableClientSession,
  loadClientSessionSync,
  updateClientSessionState,
  type ClientSessionStateUpdate,
  type ClientSessionSyncResult,
} from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./client"
import { messageCursorBefore } from "./message-window"
import { displayMessageText } from "./message-text"

export type MessageBundle = {
  info: Message
  parts: Part[]
}

export type SessionData = {
  messages: MessageBundle[]
  messageCursor?: string
  todos: Todo[]
  diffs: SnapshotFileDiff[]
}

export type DiffFile = SnapshotFileDiff | VcsFileDiff

export type SessionLoadOptions = {
  messageLimit?: number
  messageRenderBudget?: number
  messageBefore?: string
  includeSideData?: boolean
}

export type GuiSnapshot = {
  projects: OpencodeXProject[]
  sessions: Session[]
  sessionStatus: Record<string, SessionStatus>
  sessionUiState: Record<string, OpencodeXSessionUiState>
  sessionSyncRevision?: string
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  providers: Provider[]
  agents: Agent[]
  swarms: OpencodeXSwarm[]
  jobs: OpencodeXJob[]
  views: OpencodeXView[]
}

export type SessionCardSnapshot = Pick<
  GuiSnapshot,
  "projects" | "sessions" | "sessionStatus" | "sessionUiState" | "sessionSyncRevision" | "permissions" | "questions" | "views"
>

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
  const [cards, providers, agents, swarms, jobs] = await Promise.all([
    loadSessionCards(gui),
    gui.client.config.providers({ directory: gui.directory || undefined }).then((x) => x.data?.providers ?? []),
    gui.client.app.agents({ directory: gui.directory || undefined }).then((x) => x.data ?? []),
    gui.client.opencodex.swarm.list().then((x) => x.data ?? []),
    gui.client.opencodex.job.list().then((x) => x.data ?? []),
  ])
  const cardSnapshot = sessionSyncSnapshot(cards)

  return {
    ...cardSnapshot,
    sessionSyncRevision: cards.revision,
    providers,
    agents,
    swarms,
    jobs,
  }
}

export async function updateSessionUiState(gui: GuiClient, sessionID: string, input: ClientSessionStateUpdate) {
  return updateClientSessionState(gui.client, sessionID, input)
}

export async function loadSessionDiff(gui: GuiClient, input: { sessionID: string; directory?: string; messageID?: string }) {
  return gui.client.session.diff({
    sessionID: input.sessionID,
    directory: input.directory || gui.directory || undefined,
    messageID: input.messageID,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function loadVcsDiff(gui: GuiClient, input: { mode: "git" | "branch"; context?: number }) {
  return gui.client.vcs.diff({
    directory: gui.directory || undefined,
    mode: input.mode,
    context: input.context,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function loadSession(gui: GuiClient, sessionID: string, directory?: string, options: SessionLoadOptions = {}): Promise<SessionData> {
  const queryDirectory = directory || gui.directory || undefined
  const [messagePage, todos, diffs] = await Promise.all([
    loadSessionMessages(gui, sessionID, directory, { limit: options.messageLimit ?? 200, renderBudget: options.messageRenderBudget, before: options.messageBefore }),
    options.includeSideData === false ? Promise.resolve({ data: [] as Todo[] }) : gui.client.session.todo({ sessionID, directory: queryDirectory }),
    options.includeSideData === false ? Promise.resolve({ data: [] as SnapshotFileDiff[] }) : gui.client.session.diff({ sessionID, directory: queryDirectory }),
  ])
  return {
    messages: messagePage.messages,
    messageCursor: messagePage.cursor,
    todos: todos.data ?? [],
    diffs: diffs.data ?? [],
  }
}

export async function loadSessionMessages(gui: GuiClient, sessionID: string, directory: string | undefined, options: { limit: number; renderBudget?: number; before?: string }) {
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
    cursor: options.renderBudget === undefined && visible.length < messages.length && visible[0] ? messageCursorBefore(visible[0]) : response.response?.headers.get("x-next-cursor") ?? undefined,
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
  options: { directory?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string } = {},
) {
  return gui.client.session.promptAsync({
    sessionID,
    directory: options.directory || gui.directory || undefined,
    messageID: createClientMessageID(),
    agent: options.agent,
    model: options.model,
    variant: options.variant,
    parts: [{ type: "text", text }],
  }, { headers: authHeaders(gui), throwOnError: true })
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
  return gui.client.session.abort({ sessionID, directory: directory || gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function shareSession(gui: GuiClient, sessionID: string) {
  return gui.client.session.share({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function unshareSession(gui: GuiClient, sessionID: string) {
  return gui.client.session.unshare({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function summarizeSession(gui: GuiClient, input: { sessionID: string; providerID: string; modelID: string }) {
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
  return gui.client.permission.reply({
    requestID,
    directory: directory || gui.directory || undefined,
    reply,
    message,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function replyQuestion(gui: GuiClient, requestID: string, answers: QuestionAnswer[], directory?: string) {
  return gui.client.question.reply({
    requestID,
    directory: directory || gui.directory || undefined,
    answers,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function rejectQuestion(gui: GuiClient, requestID: string, directory?: string) {
  return gui.client.question.reject({
    requestID,
    directory: directory || gui.directory || undefined,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createProject(gui: GuiClient, input: { name?: string; directory: string }) {
  return gui.client.opencodex.project.create({
    opencodeXProjectCreateInput: {
      name: input.name,
      directory: input.directory,
      folders: [input.directory],
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function validateProjectFolders(gui: GuiClient, input: { projectID?: string; folders: string[] }) {
  return gui.client.opencodex.project.validate({
    opencodeXProjectValidateInput: input,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function renameProject(gui: GuiClient, projectID: string, name: string) {
  return gui.client.opencodex.project.update({ projectID, name }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateProjectFolders(gui: GuiClient, projectID: string, folders: string[]) {
  return gui.client.opencodex.project.update({ projectID, folders }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateProject(gui: GuiClient, projectID: string, input: { name: string; folders: string[] }) {
  return gui.client.opencodex.project.update({ projectID, name: input.name, folders: input.folders }, { headers: authHeaders(gui), throwOnError: true })
}

export async function reorderProjects(gui: GuiClient, projectIDs: string[]) {
  return gui.client.opencodex.project.reorder({ opencodeXProjectReorderInput: { projectIDs } }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteProject(gui: GuiClient, projectID: string) {
  return gui.client.opencodex.project.delete({ projectID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createSession(gui: GuiClient, input: { projectID?: string; directory: string; title?: string }) {
  if (input.projectID) {
    return gui.client.opencodex.session.create({
      opencodeXSessionCreateInput: {
        projectID: input.projectID,
          directory: input.directory,
          title: input.title,
        },
    }, { headers: authHeaders(gui), throwOnError: true })
  }

  return gui.client.session.create({
    directory: input.directory,
    title: input.title,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function renameSession(gui: GuiClient, sessionID: string, title: string, directory?: string) {
  return gui.client.session.update({ sessionID, directory: directory || gui.directory || undefined, title }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteSession(gui: GuiClient, sessionID: string) {
  return gui.client.opencodex.session.delete({ sessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function moveSession(gui: GuiClient, sessionID: string, projectID: string) {
  return gui.client.opencodex.session.move({
    opencodeXSessionMoveInput: { sessionID, projectID },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function getSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.get({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createSwarm(gui: GuiClient, input: { projectID: string; title?: string; prompt?: string; roles?: OpencodeXSwarmRoleInput[] }) {
  return gui.client.opencodex.swarm.create({
    opencodeXSwarmCreateInput: {
      projectID: input.projectID,
      title: input.title,
      prompt: input.prompt,
      source: "manual",
      roles: input.roles,
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateSwarm(gui: GuiClient, swarmID: string, input: { title?: string; roles?: OpencodeXSwarmRoleInput[]; metadata?: Record<string, unknown> }) {
  return gui.client.opencodex.swarm.update({
    swarmID,
    opencodeXSwarmUpdateInput: input,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function startSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.start({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function cancelSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.cancel({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteSwarm(gui: GuiClient, swarmID: string) {
  return gui.client.opencodex.swarm.delete({ swarmID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function assignSwarmTask(gui: GuiClient, swarmID: string, input: { prompt: string; agent?: string; mode?: "build" | "plan"; variant?: string }) {
  return gui.client.opencodex.swarm.task.assign({
    swarmID,
    opencodeXSwarmAssignTaskInput: {
      prompt: input.prompt,
      agent: input.agent,
      mode: input.mode,
      variant: input.variant,
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function createView(gui: GuiClient, input: { title?: string; sessionIDs: string[] }) {
  return gui.client.opencodex.view.create({
    opencodeXViewCreateInput: {
      title: input.title,
      sessionIDs: input.sessionIDs,
      focusedSessionID: input.sessionIDs[0],
      layout: "auto",
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function reorderViews(gui: GuiClient, viewIDs: string[]) {
  return gui.client.opencodex.view.reorder({ opencodeXViewReorderInput: { viewIDs } }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateViewFocus(gui: GuiClient, viewID: string, focusedSessionID: string) {
  return gui.client.opencodex.view.update({ viewID, focusedSessionID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function deleteView(gui: GuiClient, viewID: string) {
  return gui.client.opencodex.view.delete({ viewID }, { headers: authHeaders(gui), throwOnError: true })
}

export async function updateView(gui: GuiClient, viewID: string, input: { title?: string; sessionIDs?: string[]; focusedSessionID?: string; metadata?: Record<string, unknown> }) {
  return gui.client.opencodex.view.update({ viewID, ...input }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listMcpStatus(gui: GuiClient) {
  return gui.client.mcp.status({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function connectMcp(gui: GuiClient, name: string) {
  return gui.client.mcp.connect({ name, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function disconnectMcp(gui: GuiClient, name: string) {
  return gui.client.mcp.disconnect({ name, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listConsoleOrgs(gui: GuiClient) {
  return gui.client.experimental.console.listOrgs({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function switchConsoleOrg(gui: GuiClient, accountID: string, orgID: string) {
  return gui.client.experimental.console.switchOrg({ accountID, orgID, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function syncWorkspaces(gui: GuiClient) {
  return gui.client.experimental.workspace.syncList({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listWorkspaces(gui: GuiClient) {
  return gui.client.experimental.workspace.list({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function workspaceStatus(gui: GuiClient) {
  return gui.client.experimental.workspace.status({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function removeWorkspace(gui: GuiClient, id: string) {
  return gui.client.experimental.workspace.remove({ id, directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function warpSessionWorkspace(gui: GuiClient, input: { id: string | null; sessionID: string; copyChanges?: boolean }) {
  return gui.client.experimental.workspace.warp({
    directory: gui.directory || undefined,
    id: input.id,
    sessionID: input.sessionID,
    copyChanges: input.copyChanges,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function disposeInstance(gui: GuiClient) {
  return gui.client.instance.dispose({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listProviders(gui: GuiClient) {
  return gui.client.provider.list({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listProviderAuthMethods(gui: GuiClient) {
  return gui.client.provider.auth({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
}

export async function setProviderApiAuth(gui: GuiClient, providerID: string, key: string, metadata?: Record<string, string>) {
  return gui.client.auth.set({
    providerID,
    auth: {
      type: "api",
      key,
      ...(metadata ? { metadata } : {}),
    },
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function authorizeProviderOauth(gui: GuiClient, input: { providerID: string; method: number; inputs?: Record<string, string> }) {
  return gui.client.provider.oauth.authorize({
    directory: gui.directory || undefined,
    providerID: input.providerID,
    method: input.method,
    inputs: input.inputs,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function completeProviderOauth(gui: GuiClient, input: { providerID: string; method: number; code?: string }) {
  return gui.client.provider.oauth.callback({
    directory: gui.directory || undefined,
    providerID: input.providerID,
    method: input.method,
    code: input.code,
  }, { headers: authHeaders(gui), throwOnError: true })
}

export async function listSkills(gui: GuiClient) {
  return gui.client.app.skills({ directory: gui.directory || undefined }, { headers: authHeaders(gui), throwOnError: true })
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

export function isRenderableSession(session: Session) {
  return isRenderableClientSession(session)
}

function sessionSyncSnapshot(result: ClientSessionSyncResult): SessionCardSnapshot {
  if (result.changed) return { ...result.snapshot, sessionSyncRevision: result.revision }
  return {
    projects: [],
    sessions: [],
    views: [],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    sessionSyncRevision: result.revision,
  }
}

async function sessionListQuery(gui: GuiClient): Promise<{ scope?: "project"; path?: string }> {
  if (!gui.directory) return { scope: "project" }
  const current = await gui.client.project.current({ directory: gui.directory }).then((x) => x.data).catch(() => undefined)
  const worktree = current?.worktree
  if (!worktree) return { scope: "project" }
  const relative = relativePath(worktree, gui.directory)
  if (relative === undefined) return { scope: "project" }
  return { path: relative }
}

function relativePath(root: string, target: string) {
  const normalizedRoot = normalizePath(root)
  const normalizedTarget = normalizePath(target)
  const insensitive = hasWindowsDrive(normalizedRoot) || hasWindowsDrive(normalizedTarget)
  const rootKey = insensitive ? normalizedRoot.toLowerCase() : normalizedRoot
  const targetKey = insensitive ? normalizedTarget.toLowerCase() : normalizedTarget
  if (rootKey === targetKey) return ""
  const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`
  const prefixKey = insensitive ? prefix.toLowerCase() : prefix
  if (!targetKey.startsWith(prefixKey)) return undefined
  return normalizedTarget.slice(prefix.length)
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "")
}

function hasWindowsDrive(value: string) {
  return /^[a-zA-Z]:\//.test(value)
}

function authHeaders(gui: GuiClient) {
  return gui.authHeader ? { authorization: gui.authHeader } : undefined
}
