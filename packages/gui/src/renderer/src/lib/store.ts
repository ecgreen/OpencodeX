import type {
  Agent,
  GlobalEvent,
  Message,
  OpencodeXJob,
  OpencodeXProject,
  OpencodeXSwarm,
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
} from "@opencode-ai/sdk/v2/client"
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
  messageTailDetached?: boolean
  todos: Todo[]
  diffs: SnapshotFileDiff[]
}

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
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  providers: Provider[]
  agents: Agent[]
  swarms: OpencodeXSwarm[]
  jobs: OpencodeXJob[]
  views: OpencodeXView[]
}

export type SessionCardSnapshot = Pick<GuiSnapshot, "projects" | "sessions" | "sessionStatus" | "permissions" | "questions">

const SESSION_LIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const ID_RANDOM_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastClientMessageIDTimestamp = 0
let clientMessageIDCounter = 0

export async function loadSessionCards(gui: GuiClient): Promise<SessionCardSnapshot> {
  const sessionQuery = await sessionListQuery(gui)
  const [projects, sessions] = await Promise.all([
    gui.client.opencodex.project.list().then((x) => x.data ?? []),
    gui.client.session.list({ start: Date.now() - SESSION_LIST_WINDOW_MS, ...sessionQuery }).then((x) => x.data ?? []),
  ])
  const merged = mergeSessions(sessions, projects)
  const directories = Array.from(new Set([gui.directory, ...merged.map((session) => session.directory)].filter(Boolean)))
  const workspaces = Array.from(new Set(merged.map((session) => session.workspaceID).filter((workspaceID): workspaceID is string => Boolean(workspaceID))))
  const [sessionStatus, permissions, questions] = await Promise.all([
    Promise.all([
      ...directories.map((directory) => gui.client.session.status({ directory }).then((x) => x.data ?? {})),
      ...workspaces.map((workspace) => gui.client.session.status({ workspace }).then((x) => x.data ?? {})),
    ]).then((items) => Object.assign({}, ...items)),
    Promise.all(directories.map((directory) => gui.client.permission.list({ directory }).then((x) => x.data ?? []))).then((x) => x.flat()),
    Promise.all(directories.map((directory) => gui.client.question.list({ directory }).then((x) => x.data ?? []))).then((x) => x.flat()),
  ])

  return {
    projects,
    sessions: merged,
    sessionStatus,
    permissions,
    questions,
  }
}

export async function loadSnapshot(gui: GuiClient): Promise<GuiSnapshot> {
  const [cards, providers, agents, swarms, jobs, views] = await Promise.all([
    loadSessionCards(gui),
    gui.client.config.providers({ directory: gui.directory || undefined }).then((x) => x.data?.providers ?? []),
    gui.client.app.agents({ directory: gui.directory || undefined }).then((x) => x.data ?? []),
    gui.client.opencodex.swarm.list().then((x) => x.data ?? []),
    gui.client.opencodex.job.list().then((x) => x.data ?? []),
    gui.client.opencodex.view.list().then((x) => x.data ?? []),
  ])

  return {
    ...cards,
    providers,
    agents,
    swarms,
    jobs,
    views,
  }
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

export async function createSwarm(gui: GuiClient, input: { projectID: string; title?: string; prompt?: string }) {
  return gui.client.opencodex.swarm.create({
    opencodeXSwarmCreateInput: {
      projectID: input.projectID,
      title: input.title,
      prompt: input.prompt,
      source: "manual",
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

export async function updateView(gui: GuiClient, viewID: string, input: { sessionIDs?: string[]; focusedSessionID?: string; metadata?: Record<string, unknown> }) {
  return gui.client.opencodex.view.update({ viewID, ...input }, { headers: authHeaders(gui), throwOnError: true })
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

function mergeSessions(sessions: Session[], projects: OpencodeXProject[]) {
  return Array.from(
    new Map(
      [...sessions, ...projects.flatMap((project) => project.sessions as Session[])].map((session) => [session.id, session]),
    ).values(),
  ).filter(isRenderableSession).toSorted((a, b) => b.time.updated - a.time.updated)
}

export function isRenderableSession(session: Session) {
  if (session.parentID) return true
  if (session.model || session.summary || session.share || session.revert) return true
  const tokens = session.tokens
  if (tokens && tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0) return true
  if ((session.cost ?? 0) > 0) return true
  return !isPlaceholderTitle(session.title)
}

function isPlaceholderTitle(title: string) {
  return title === "New session" || /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
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
