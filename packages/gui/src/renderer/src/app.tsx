import type { JSX } from "solid-js"
import type { Agent, GlobalEvent, Part, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, MessageBundle, SessionData } from "./lib/store"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Mark } from "@opencode-ai/ui/logo"
import { Markdown } from "@opencode-ai/ui/markdown"
import { connectGuiClient } from "./lib/client"
import { compactPath, formatRelative, title } from "./lib/format"
import { displayMessageText } from "./lib/message-text"
import {
  abortSession,
  createProject,
  createSession,
  createSwarm,
  createView,
  deleteProject,
  deleteSession,
  loadSession,
  loadSnapshot,
  moveSession,
  rejectQuestion,
  renameProject,
  renameSession,
  reorderProjects,
  reorderViews,
  replyPermission,
  replyQuestion,
  sendPrompt,
  subscribeEvents,
  updateProjectFolders,
  validateProjectFolders,
} from "./lib/store"

type Route =
  | { name: "dashboard" }
  | { name: "sessions" }
  | { name: "projects" }
  | { name: "session"; sessionID: string }
  | { name: "swarms" }
  | { name: "views" }
  | { name: "settings" }
  | { name: "status" }

type DialogState =
  | { type: "text"; title: string; message?: string; value?: string; multiline?: boolean; resolve: (value: string | undefined) => void }
  | { type: "confirm"; title: string; message: string; confirm?: string; resolve: (value: boolean) => void }

const NAV_ITEMS = [
  { name: "dashboard", label: "Dashboard", icon: "dashboard", shortcut: "Ctrl+D", description: "Workspace command center" },
  { name: "sessions", label: "Sessions", icon: "session", shortcut: "Ctrl+1", description: "Resume and monitor agent sessions" },
  { name: "projects", label: "Projects", icon: "folder", shortcut: "Ctrl+2", description: "Project groups and folders" },
  { name: "views", label: "Views", icon: "views", shortcut: "Ctrl+4", description: "Multi-session views" },
  { name: "swarms", label: "Swarms", icon: "swarm", shortcut: "Ctrl+3", description: "Coordinate AI team runs" },
  { name: "status", label: "Status", icon: "activity", shortcut: "Ctrl+5", description: "Provider and runtime health" },
  { name: "settings", label: "Settings", icon: "settings", shortcut: "Ctrl+6", description: "Preferences and provider setup" },
] as const

const GLOBAL_SHORTCUT_KEYS = new Set(["b", "/", "n", "r", "d", "1", "2", "3", "4", "5", "6"])
const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
const PROJECT_RECENT_SESSION_LIMIT = 4

type RailSectionName = "projects" | "recent" | "swarms" | "views"
type DragTarget = { type: "project"; id: string } | { type: "view"; id: string }
type SidebarSessionSource = "project" | "recent"

export function App() {
  const [client, setClient] = createSignal<GuiClient>()
  const [snapshot, setSnapshot] = createSignal<GuiSnapshot>()
  const [route, setRoute] = createSignal<Route>({ name: "dashboard" })
  const [sessionData, setSessionData] = createSignal<SessionData>(EMPTY_SESSION_DATA)
  const [sessionDataSessionID, setSessionDataSessionID] = createSignal("")
  const [loading, setLoading] = createSignal("Starting sidecar")
  const [error, setError] = createSignal<string>()
  const [prompt, setPrompt] = createSignal("")
  const [selectionSessionID, setSelectionSessionID] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal("")
  const [selectedModel, setSelectedModel] = createSignal("")
  const [selectedVariant, setSelectedVariant] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [dialog, setDialog] = createSignal<DialogState>()
  const [railCollapsed, setRailCollapsed] = createSignal(false)
  const [loadingSessionID, setLoadingSessionID] = createSignal("")
  const [railSections, setRailSections] = createSignal<Record<RailSectionName, boolean>>({ projects: false, recent: false, swarms: false, views: true })
  const [expandedProjectIDs, setExpandedProjectIDs] = createSignal<Record<string, boolean>>({})
  const [sidebarSessionSource, setSidebarSessionSource] = createSignal<{ sessionID: string; source: SidebarSessionSource }>()
  const [viewedSessions, setViewedSessions] = createSignal(readViewedSessions())
  const [recentModels, setRecentModels] = createSignal(readRecentModels())
  const [dragTarget, setDragTarget] = createSignal<DragTarget>()
  let sessionSyncRequestID = 0

  const selectedSession = createMemo(() => {
    const current = route()
    if (current.name !== "session") return
    return snapshot()?.sessions.find((session) => session.id === current.sessionID)
  })
  const activeSessionID = createMemo(() => {
    const current = route()
    if (current.name !== "session") return ""
    return current.sessionID
  })
  const activeSessionData = createMemo(() => sessionDataSessionID() === activeSessionID() ? sessionData() : EMPTY_SESSION_DATA)
  const activeSessionLoading = createMemo(() => loadingSessionID() === activeSessionID() && sessionDataSessionID() !== activeSessionID())
  const selectedPermissions = createMemo(() => {
    const session = selectedSession()
    if (!session) return []
    return snapshot()?.permissions.filter((request) => request.sessionID === session.id) ?? []
  })
  const selectedQuestions = createMemo(() => {
    const session = selectedSession()
    if (!session) return []
    return snapshot()?.questions.filter((request) => request.sessionID === session.id) ?? []
  })
  const visibleSessions = createMemo(() => tuiSidebarSessions(snapshot()))
  const recentSessions = createMemo(() => visibleSessions().filter((session) => isRecentSessionUpdate(session.time.updated)))

  async function refresh(options?: { confirmIdleSessionID?: string }) {
    const gui = client()
    if (!gui) return
    const next = await loadSnapshot(gui)
    setSnapshot((current) =>
      current ? { ...next, sessionStatus: confirmedSessionStatus(current.sessionStatus, next.sessionStatus, options?.confirmIdleSessionID) } : next,
    )
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), recentModels())
    if (models.join("\n") === recentModels().join("\n")) return
    setRecentModels(models)
    writeRecentModels(models)
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function alert(message: string) {
    setNotice(message)
  }

  function askText(input: { title: string; message?: string; value?: string; multiline?: boolean }) {
    return new Promise<string | undefined>((resolve) => setDialog({ type: "text", ...input, resolve }))
  }

  function confirm(input: { title: string; message: string; confirm?: string }) {
    return new Promise<boolean>((resolve) => setDialog({ type: "confirm", ...input, resolve }))
  }

  async function syncSession(sessionID: string) {
    const gui = client()
    if (!gui) return
    const requestID = ++sessionSyncRequestID
    setLoadingSessionID(sessionID)
    try {
      const data = await loadSession(gui, sessionID, snapshot()?.sessions.find((session) => session.id === sessionID)?.directory)
      if (requestID !== sessionSyncRequestID) return
      const current = route()
      if (current.name !== "session" || current.sessionID !== sessionID) return
      setSessionData(data)
      setSessionDataSessionID(sessionID)
    } catch (cause) {
      if (requestID === sessionSyncRequestID) setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestID === sessionSyncRequestID && loadingSessionID() === sessionID) setLoadingSessionID("")
    }
  }

  function applySessionStatusEvent(sessionID: string, status: NonNullable<GuiSnapshot["sessionStatus"][string]>) {
    setSnapshot((current) => {
      if (!current) return current
      if (status.type === "idle") {
        return {
          ...current,
          sessionStatus: Object.fromEntries(Object.entries(current.sessionStatus).filter(([id]) => id !== sessionID)),
        }
      }
      return { ...current, sessionStatus: { ...current.sessionStatus, [sessionID]: status } }
    })
  }

  onMount(async () => {
    try {
      const gui = await connectGuiClient()
      setClient(gui)
      setLoading("Loading workspace")
      await refresh()
      const unsubscribe = subscribeEvents(gui, (event) => {
        if (event.payload.type === "session.status") {
          if (event.payload.properties.status.type === "idle") void refresh({ confirmIdleSessionID: event.payload.properties.sessionID })
          else applySessionStatusEvent(event.payload.properties.sessionID, event.payload.properties.status)
        }
        else void refresh()
        const current = route()
        const sessionID = eventSessionID(event)
        if (current.name === "session" && sessionID === current.sessionID) void syncSession(current.sessionID)
      })
      onCleanup(unsubscribe)
      setLoading("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  })

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      const key = event.key.toLowerCase()
      if (event.key === "Escape" && notice()) {
        event.preventDefault()
        setNotice("")
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (dialog() || editing) {
        if (GLOBAL_SHORTCUT_KEYS.has(key)) event.preventDefault()
        return
      }
      if (key === "b") {
        event.preventDefault()
        setRailCollapsed((value) => !value)
        return
      }
      if (key === "/") {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()
        return
      }
      if (key === "n") {
        event.preventDefault()
        void runAction(() => handleCreateSession())
        return
      }
      if (key === "r") {
        event.preventDefault()
        void runAction(refresh)
        return
      }
      const targetRoute = key === "d" ? "dashboard" : key === "1" ? "sessions" : key === "2" ? "projects" : key === "3" ? "swarms" : key === "4" ? "views" : key === "5" ? "status" : key === "6" ? "settings" : undefined
      if (!targetRoute) return
      event.preventDefault()
      setRoute({ name: targetRoute })
    }
    window.addEventListener("keydown", handleKeydown)
    onCleanup(() => window.removeEventListener("keydown", handleKeydown))
  })

  createEffect(() => {
    const current = route()
    if (current.name === "session") void syncSession(current.sessionID)
  })

  createEffect(() => {
    const session = selectedSession()
    if (!session) return
    markSessionViewed(session.id, Math.max(Date.now(), session.time.updated))
  })

  createEffect(() => {
    const session = selectedSession()
    if (!session || selectionSessionID() === session.id) return
    setSelectionSessionID(session.id)
    setSelectedAgent(session.agent ?? "")
    setSelectedModel(session.model ? modelValue(session.model.providerID, session.model.id) : recentModels()[0] ?? firstAvailableModel(snapshot()?.providers ?? []) ?? "")
    setSelectedVariant(session.model?.variant ?? "")
  })

  createEffect(() => {
    if (selectedModel()) return
    const model = recentModels()[0] ?? firstAvailableModel(snapshot()?.providers ?? [])
    if (model) setSelectedModel(model)
  })

  async function submitPrompt(event: SubmitEvent) {
    event.preventDefault()
    const gui = client()
    const session = selectedSession()
    const text = prompt().trim()
    if (!gui || !session || !text) return
    if (selectedPermissions().length > 0 || selectedQuestions().length > 0) return
    const model = parseModelValue(selectedModel())
    setPrompt("")
    setLoadingSessionID(session.id)
    await sendPrompt(gui, session.id, text, {
      directory: session.directory,
      agent: selectedAgent() || undefined,
      model,
      variant: selectedVariant() || undefined,
    })
    if (selectedModel()) rememberModel(selectedModel())
    await syncSession(session.id)
    await refresh()
  }

  function rememberModel(value: string) {
    const next = mergeRecentModels([value], recentModels())
    setRecentModels(next)
    writeRecentModels(next)
  }

  function markSessionViewed(sessionID: string, time: number) {
    if ((viewedSessions()[sessionID] ?? 0) >= time) return
    const next = { ...viewedSessions(), [sessionID]: time }
    setViewedSessions(next)
    writeViewedSessions(next)
  }

  function toggleRailSection(name: RailSectionName) {
    setRailSections((current) => ({ ...current, [name]: !current[name] }))
  }

  function toggleProject(projectID: string) {
    setExpandedProjectIDs((current) => ({ ...current, [projectID]: !projectExpanded(projectID) }))
  }

  function projectExpanded(projectID: string) {
    return expandedProjectIDs()[projectID] ?? true
  }

  function openSidebarSession(sessionID: string, source: SidebarSessionSource) {
    setSidebarSessionSource({ sessionID, source })
    setRoute({ name: "session", sessionID })
  }

  function sidebarSessionActive(sessionID: string, source: SidebarSessionSource) {
    const selected = sidebarSessionSource()
    if (activeSessionID() !== sessionID) return false
    if (selected?.sessionID !== sessionID) return source === "project"
    return selected.source === source
  }

  async function handleAbortSession(sessionID: string) {
    const gui = client()
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!gui) return
    await abortSession(gui, sessionID, session?.directory)
    await refresh()
  }

  async function handleRenameSession(session: Session) {
    const gui = client()
    if (!gui) return
    const next = (await askText({ title: "Rename Session", value: session.title }))?.trim()
    if (!next) return
    await renameSession(gui, session.id, next, session.directory)
    await refresh()
  }

  async function handleMoveSession(session: Session) {
    const gui = client()
    const projects = snapshot()?.projects ?? []
    if (!gui || projects.length === 0) return alert("Create or load a project before moving a session.")
    const projectID = await chooseProjectID(projects)
    if (!projectID) return
    if (!(await confirm({ title: "Move Session", message: `Move "${session.title}" to this project?\n\n${projectID}`, confirm: "Move" }))) return
    await moveSession(gui, session.id, projectID)
    await refresh()
  }

  async function handleDeleteSession(session: Session) {
    const gui = client()
    if (!gui) return
    if (!(await confirm({ title: "Delete Session", message: `Delete "${session.title}"?\n\nThis permanently deletes session data.`, confirm: "Delete" }))) return
    await deleteSession(gui, session.id)
    await refresh()
    setRoute({ name: "dashboard" })
  }

  async function handlePermission(request: PermissionRequest, reply: "once" | "always" | "reject") {
    const gui = client()
    if (!gui) return
    const message = reply === "reject" ? await askText({ title: "Reject Permission", message: "Optional feedback for the agent" }) : undefined
    if (reply === "always" && !(await confirm({ title: "Always Allow", message: request.always.join("\n") || request.permission, confirm: "Always Allow" }))) return
    await replyPermission(gui, request.id, reply, message, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function handleQuestionReply(request: QuestionRequest, answers: QuestionAnswer[]) {
    const gui = client()
    if (!gui) return
    await replyQuestion(gui, request.id, answers, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function handleQuestionReject(request: QuestionRequest) {
    const gui = client()
    if (!gui) return
    await rejectQuestion(gui, request.id, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function chooseFolder(fallback: string) {
    const selected = await window.opencodex?.folder()
    if (selected) return selected
    return fallback || undefined
  }

  async function handleCreateProject() {
    const gui = client()
    if (!gui) return
    const directory = await chooseFolder(gui.directory || ".")
    if (!directory) return
    const name = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "New Project"
    const validation = await validateProjectFolders(gui, { folders: [directory] })
    if (validation.data && !validation.data.valid) {
      alert(validation.data.folders.map((folder) => folder.message ?? `${folder.input} is invalid`).join("\n"))
      return
    }
    await createProject(gui, { name, directory })
    await refresh()
  }

  async function handleRenameProject(projectID: string, current?: string) {
    const gui = client()
    if (!gui) return
    const name = (await askText({ title: "Rename Project", value: current ?? "" }))?.trim()
    if (!name) return
    await renameProject(gui, projectID, name)
    await refresh()
  }

  async function handleEditProjectFolders(projectID: string, folders: string[]) {
    const gui = client()
    if (!gui) return
    const input = await askText({ title: "Project Folders", message: "One folder per line", value: folders.join("\n"), multiline: true })
    if (!input) return
    const next = input.split(/\r?\n/).map((folder) => folder.trim()).filter(Boolean)
    if (next.length === 0) return
    const validation = await validateProjectFolders(gui, { projectID, folders: next })
    if (validation.data && !validation.data.valid) {
      alert(validation.data.folders.map((folder) => folder.message ?? `${folder.input} is invalid`).join("\n"))
      return
    }
    await updateProjectFolders(gui, projectID, next)
    await refresh()
  }

  async function handleDeleteProject(projectID: string, name: string) {
    const gui = client()
    if (!gui) return
    if (!(await confirm({ title: "Delete Project", message: `Delete OpencodeX project grouping "${name}"?\n\nThis removes the GUI/TUI project grouping.`, confirm: "Delete" }))) return
    await deleteProject(gui, projectID)
    await refresh()
  }

  async function handleCreateSession(projectID?: string, directory?: string) {
    const gui = client()
    if (!gui) return
    const target = directory ?? snapshot()?.projects[0]?.folders[0]?.path ?? gui.directory
    if (!target) return
    const response = await createSession(gui, {
      projectID,
      directory: target,
      title: "New session",
    })
    await refresh()
    const sessionID = response.data?.id
    if (sessionID) setRoute({ name: "session", sessionID })
  }

  async function handleCreateSwarm() {
    const gui = client()
    const projects = snapshot()?.projects ?? []
    if (!gui || projects.length === 0) return alert("Create or load a project before creating a swarm.")
    const projectID = await chooseProjectID(projects)
    if (!projectID) return
    await createSwarm(gui, {
      projectID,
      title: "New swarm",
      prompt: "",
    })
    await refresh()
    setRoute({ name: "swarms" })
  }

  async function handleCreateView() {
    const gui = client()
    const sessions = snapshot()?.sessions ?? []
    if (!gui || sessions.length === 0) return alert("Create or load at least one session before creating a view.")
    const sessionIDs = await chooseSessionIDs(sessions)
    if (sessionIDs.length === 0) return
    await createView(gui, {
      title: "New view",
      sessionIDs,
    })
    await refresh()
    setRoute({ name: "views" })
  }

  async function handleMoveProject(projectID: string, offset: number) {
    const projectIDs = moveByOffset((snapshot()?.projects ?? []).map((project) => project.id), projectID, offset)
    const gui = client()
    if (!gui || projectIDs.length === 0) return
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleMoveView(viewID: string, offset: number) {
    const viewIDs = moveByOffset((snapshot()?.views ?? []).map((view) => view.id), viewID, offset)
    const gui = client()
    if (!gui || viewIDs.length === 0) return
    await reorderViews(gui, viewIDs)
    await refresh()
  }

  async function handleDropProject(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    setDragTarget(undefined)
    if (!source || source.type !== "project" || source.id === targetID) return
    const projectIDs = moveRelative((snapshot()?.projects ?? []).map((project) => project.id), source.id, targetID, placement)
    const gui = client()
    if (!gui || projectIDs.length === 0) return
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleDropView(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    setDragTarget(undefined)
    if (!source || source.type !== "view" || source.id === targetID) return
    const viewIDs = moveRelative((snapshot()?.views ?? []).map((view) => view.id), source.id, targetID, placement)
    const gui = client()
    if (!gui || viewIDs.length === 0) return
    await reorderViews(gui, viewIDs)
    await refresh()
  }

  async function chooseProjectID(projects: GuiSnapshot["projects"]) {
    if (projects.length === 1) return projects[0].id
    const options = projects.map((project) => `${project.id} - ${title(project.name ?? project.project.name)}`).join("\n")
    const selected = (await askText({ title: "Choose Project", message: options, value: projects[0].id }))?.trim()
    return projects.some((project) => project.id === selected) ? selected : undefined
  }

  async function chooseSessionIDs(sessions: Session[]) {
    const options = sessions.slice(0, 20).map((session) => `${session.id} - ${title(session.title)}`).join("\n")
    const selected = await askText({ title: "Choose Sessions", message: `Comma-separated session IDs:\n${options}` })
    if (!selected) return []
    const available = new Set(sessions.map((session) => session.id))
    return selected
      .split(",")
      .map((id) => id.trim())
      .filter((id, index, all) => available.has(id) && all.indexOf(id) === index)
      .slice(0, 8)
  }

  function startDrag(event: DragEvent, target: DragTarget) {
    setDragTarget(target)
    event.dataTransfer?.setData("text/plain", target.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
  }

  return (
    <div class="app-shell" classList={{ "rail-collapsed": railCollapsed() }}>
      <Titlebar />
      <aside class="rail" aria-label="OpencodeX navigation">
        <div class="brand" onClick={() => setRoute({ name: "dashboard" })}>
          <span class="brand-mark"><Mark /></span>
          <div class="brand-copy">
            <strong>OpencodeX</strong>
            <span>{snapshot()?.projects[0] ? title(snapshot()!.projects[0].name ?? snapshot()!.projects[0].project.name) : "Command center"}</span>
          </div>
          <div class="brand-actions">
            <button class="rail-toggle" title={`${railCollapsed() ? "Expand" : "Collapse"} sidebar (Ctrl+B)`} aria-label="Toggle sidebar" aria-expanded={!railCollapsed()} onClick={(event) => {
              event.stopPropagation()
              setRailCollapsed((value) => !value)
            }}><Icon name="panel" /></button>
            <Show when={railCollapsed()}>
              <button class="new-button" title="New session (Ctrl+N)" aria-label="New session" onClick={(event) => {
                event.stopPropagation()
                void runAction(() => handleCreateSession())
              }}><Icon name="plus" /></button>
            </Show>
          </div>
        </div>
        <Show when={!railCollapsed()}>
          <nav class="nav">
            <For each={NAV_ITEMS}>
              {(item) => (
                <button aria-label={`${item.label}: ${item.description}`} title={`${item.label}: ${item.description} (${item.shortcut})`} classList={{ active: route().name === item.name }} onClick={() => setRoute({ name: item.name })}>
                  <Icon name={item.icon} />
                  <span class="nav-label">{item.label}</span>
                  <small>{item.shortcut}</small>
                </button>
              )}
            </For>
          </nav>
        </Show>
        <div class="rail-scroll">
          <RailSection title="Projects" count={snapshot()?.projects.length ?? 0} collapsed={railSections().projects} toggle={() => toggleRailSection("projects")} action={() => void runAction(handleCreateProject)}>
            <For each={snapshot()?.projects ?? []}>
              {(project) => (
                <div
                  class="project-group"
                  classList={{ dropping: dragTarget()?.type === "project" && dragTarget()?.id !== project.id }}
                  onDragOver={allowDrop}
                  onDrop={(event) => void runAction(() => handleDropProject(project.id, dropPlacement(event)))}
                >
                  <div class="project-heading">
                    <button
                      class="drag-handle"
                      draggable
                      title="Drag to reorder project. Alt+Up/Down also moves it."
                      aria-label="Reorder project with drag or Alt+ArrowUp and Alt+ArrowDown"
                      onDragStart={(event) => startDrag(event, { type: "project", id: project.id })}
                      onDragEnd={() => setDragTarget(undefined)}
                      onKeyDown={(event) => {
                        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                        event.preventDefault()
                        void runAction(() => handleMoveProject(project.id, event.key === "ArrowUp" ? -1 : 1))
                      }}
                    ><Icon name="grip" /></button>
                    <button class="project-toggle" aria-expanded={projectExpanded(project.id)} onClick={() => toggleProject(project.id)}>{projectExpanded(project.id) ? "-" : "+"}</button>
                    <button title="Open project group" onClick={() => setRoute({ name: "projects" })}>{title(project.name ?? project.project.name)}</button>
                    <button title="New session in project" onClick={() => void runAction(() => handleCreateSession(project.id, project.folders[0]?.path))}>+</button>
                  </div>
                  <Show when={projectExpanded(project.id)}>
                    <For each={recentProjectSessions(projectSessions(project, snapshot()))}>
                      {(session) => (
                        <SidebarSessionLink session={session} snapshot={snapshot()} lastViewed={viewedSessions()[session.id] ?? 0} active={sidebarSessionActive(session.id, "project")} nested onClick={() => openSidebarSession(session.id, "project")} />
                      )}
                    </For>
                  </Show>
                </div>
              )}
            </For>
          </RailSection>
          <RailSection title="Recent Sessions" count={recentSessions().length} collapsed={railSections().recent} toggle={() => toggleRailSection("recent")} action={() => void runAction(() => handleCreateSession())}>
            <For each={recentSessions()}>
              {(session) => (
                <SidebarSessionLink session={session} snapshot={snapshot()} lastViewed={viewedSessions()[session.id] ?? 0} active={sidebarSessionActive(session.id, "recent")} onClick={() => openSidebarSession(session.id, "recent")} />
              )}
            </For>
          </RailSection>
          <RailSection title="Swarms" count={(snapshot()?.swarms ?? []).length} collapsed={railSections().swarms} toggle={() => toggleRailSection("swarms")} action={() => void runAction(handleCreateSwarm)}>
            <For each={(snapshot()?.swarms ?? []).slice(0, 8)}>
              {(swarm) => <button title={`${title(swarm.title)} - ${swarm.status}`} class="session-link" onClick={() => setRoute({ name: "swarms" })}><span>{title(swarm.title)}</span><small>{swarm.status}</small></button>}
            </For>
          </RailSection>
          <RailSection title="Views" count={(snapshot()?.views ?? []).length} collapsed={railSections().views} toggle={() => toggleRailSection("views")} action={() => void runAction(handleCreateView)}>
            <For each={(snapshot()?.views ?? []).slice(0, 8)}>
              {(view) => (
                <div class="draggable-row" classList={{ dropping: dragTarget()?.type === "view" && dragTarget()?.id !== view.id }} onDragOver={allowDrop} onDrop={(event) => void runAction(() => handleDropView(view.id, dropPlacement(event)))}>
                  <button
                    class="drag-handle"
                    draggable
                    title="Drag to reorder view. Alt+Up/Down also moves it."
                    aria-label="Reorder view with drag or Alt+ArrowUp and Alt+ArrowDown"
                    onDragStart={(event) => startDrag(event, { type: "view", id: view.id })}
                    onDragEnd={() => setDragTarget(undefined)}
                    onKeyDown={(event) => {
                      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                      event.preventDefault()
                      void runAction(() => handleMoveView(view.id, event.key === "ArrowUp" ? -1 : 1))
                    }}
                  ><Icon name="grip" /></button>
                  <button title={`${title(view.title)} - ${view.sessionIDs.length} sessions`} class="session-link" onClick={() => setRoute({ name: "views" })}><span>{title(view.title)}</span><small>{view.sessionIDs.length} sessions</small></button>
                </div>
              )}
            </For>
          </RailSection>
        </div>
      </aside>
      <main class="stage">
        <Show when={notice()}>
          <button class="notice" onClick={() => setNotice("")}>{notice()}</button>
        </Show>
        <Show when={loading()}>
          <div class="loading-card">{loading()}...</div>
        </Show>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
        <Show when={!loading() && !error()}>
          <Switch>
            <Match when={route().name === "dashboard"}>
              <Dashboard
                snapshot={snapshot()}
                setRoute={setRoute}
                refresh={refresh}
                createProject={() => void runAction(handleCreateProject)}
                createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))}
                createSwarm={() => void runAction(handleCreateSwarm)}
                createView={() => void runAction(handleCreateView)}
                renameProject={(projectID, current) => void runAction(() => handleRenameProject(projectID, current))}
                editProjectFolders={(projectID, folders) => void runAction(() => handleEditProjectFolders(projectID, folders))}
                deleteProject={(projectID, name) => void runAction(() => handleDeleteProject(projectID, name))}
              />
            </Match>
            <Match when={route().name === "session"}>
              <SessionPage
                session={selectedSession()}
                data={activeSessionData()}
                loading={activeSessionLoading()}
                prompt={prompt()}
                setPrompt={setPrompt}
                providers={snapshot()?.providers ?? []}
                agents={snapshot()?.agents ?? []}
                selectedAgent={selectedAgent()}
                setSelectedAgent={setSelectedAgent}
                selectedModel={selectedModel()}
                recentModels={recentModels()}
                setSelectedModel={(value) => {
                  setSelectedModel(value)
                  setSelectedVariant("")
                  if (value) rememberModel(value)
                }}
                selectedVariant={selectedVariant()}
                setSelectedVariant={setSelectedVariant}
                submit={submitPrompt}
                permissions={selectedPermissions()}
                questions={selectedQuestions()}
                replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
                replyQuestion={(request, answers) => void runAction(() => handleQuestionReply(request, answers))}
                rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
                abortSession={(sessionID) => void runAction(() => handleAbortSession(sessionID))}
                renameSession={(session) => void runAction(() => handleRenameSession(session))}
                moveSession={(session) => void runAction(() => handleMoveSession(session))}
                deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                status={selectedSession() ? snapshot()?.sessionStatus[selectedSession()!.id]?.type : undefined}
              />
            </Match>
            <Match when={route().name === "sessions"}>
              <SessionCollectionPage snapshot={snapshot()} setRoute={setRoute} />
            </Match>
            <Match when={route().name === "projects"}>
              <ProjectCollectionPage snapshot={snapshot()} createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))} />
            </Match>
            <Match when={route().name === "swarms"}>
              <CollectionPage title="Swarms" count={snapshot()?.swarms.length ?? 0} description="Create, run, cancel, and inspect orchestrated swarm work through existing OpencodeX endpoints." />
            </Match>
            <Match when={route().name === "views"}>
              <CollectionPage title="Multi-Session Views" count={snapshot()?.views.length ?? 0} description="Open up to eight sessions together with per-pane focus and prompt targeting." />
            </Match>
            <Match when={route().name === "status"}>
              <StatusPage snapshot={snapshot()} />
            </Match>
            <Match when={route().name === "settings"}>
              <CollectionPage title="Settings" count={snapshot()?.agents.length ?? 0} description="Theme, provider, status, docs, debug, and safe GUI preferences are reserved here while settings parity is built out." />
            </Match>
          </Switch>
        </Show>
      </main>
      <DialogModal dialog={dialog()} close={() => setDialog(undefined)} />
    </div>
  )
}

function DialogModal(props: { dialog?: DialogState; close: () => void }) {
  const [value, setValue] = createSignal("")
  createEffect(() => setValue(props.dialog?.type === "text" ? props.dialog.value ?? "" : ""))
  function cancel() {
    const current = props.dialog
    props.close()
    if (!current) return
    if (current.type === "text") current.resolve(undefined)
    else current.resolve(false)
  }
  function submit(event: SubmitEvent) {
    event.preventDefault()
    const current = props.dialog
    props.close()
    if (!current) return
    if (current.type === "text") current.resolve(value())
    else current.resolve(true)
  }
  return (
    <Show when={props.dialog}>
      {(current) => (
        <div class="dialog-backdrop" onMouseDown={cancel}>
          <form class="dialog-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{current().title}</h2>
            <Show when={current().message}>
              <p>{current().message}</p>
            </Show>
            <Show when={current().type === "text"}>
              <Show when={(current() as Extract<DialogState, { type: "text" }>).multiline} fallback={<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />}>
                <textarea value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
              </Show>
            </Show>
            <div class="dialog-actions">
              <button type="button" class="secondary" onClick={cancel}>Cancel</button>
              <button type="submit" class="primary">{current().type === "confirm" ? (current() as Extract<DialogState, { type: "confirm" }>).confirm ?? "Confirm" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </Show>
  )
}

function Titlebar() {
  return (
    <header class="titlebar">
      <div class="titlebar-drag">
        <Mark />
        <span>OpencodeX</span>
        <small>Premium AI development environment</small>
      </div>
      <div class="window-controls">
        <button aria-label="Minimize" onClick={() => void window.opencodex?.window("minimize")}>-</button>
        <button aria-label="Maximize" onClick={() => void window.opencodex?.window("maximize")}>□</button>
        <button aria-label="Close" class="close" onClick={() => void window.opencodex?.window("close")}>×</button>
      </div>
    </header>
  )
}

function Icon(props: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    activity: <path d="M3 12h4l2-7 4 14 2-7h5" />,
    dashboard: <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
    folder: <path d="M3 7h7l2 2h9v10H3z" />,
    grip: <path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    panel: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14M6 9h.01M6 12h.01M6 15h.01" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="M5 19 20 5M20 5l-5 14-3-7-7-3 15-4z" />,
    session: <path d="M4 5h16v11H8l-4 4z" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
    stop: <path d="M8 8h8v8H8z" />,
    swarm: <path d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 10l-3 6M14 10l3 6M9 19h6" />,
    views: <path d="M4 5h8v8H4zM12 11h8v8h-8z" />,
  }
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {paths[props.name] ?? paths.dashboard}
    </svg>
  )
}

function RailSection(props: { title: string; count: number; collapsed: boolean; toggle: () => void; action: () => void; children: JSX.Element }) {
  return (
    <section class="rail-section">
      <header>
        <button class="section-toggle" aria-expanded={!props.collapsed} onClick={props.toggle}>
          <span>{props.collapsed ? "+" : "-"}</span>
          <strong>{props.title}</strong>
          <small>{props.count}</small>
        </button>
        <button title={`Create ${props.title}`} aria-label={`Create ${props.title}`} onClick={props.action}>+</button>
      </header>
      <Show when={!props.collapsed}>{props.children}</Show>
    </section>
  )
}

function Dashboard(props: {
  snapshot?: GuiSnapshot
  setRoute: (route: Route) => void
  refresh: () => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: () => void
  createView: () => void
  renameProject: (projectID: string, current?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  const recentSessions = createMemo(() => sessions().filter((session) => isRecentSessionUpdate(session.time.updated)))
  const priorSessions = createMemo(() => sessions().filter((session) => !isRecentSessionUpdate(session.time.updated)))
  const attentionJobs = createMemo(() => (props.snapshot?.jobs ?? []).filter((job) => ["input_needed", "approval_needed", "blocked", "failed"].includes(job.status)).slice(0, 8))
  const attentionCount = createMemo(() => (props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0) + attentionJobs().length)
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const toggleSection = (section: string) => setCollapsed((value) => ({ ...value, [section]: !value[section] }))
  return (
    <div class="page dashboard-page">
      <OpencodeXLogo />
      <section class="dashboard-actions" aria-label="Create new OpencodeX items">
        <DashboardActionCard title="Create Project" description="Group sessions, swarms, and views around a workspace." meta={`${props.snapshot?.projects.length ?? 0} projects`} tone="primary" onClick={props.createProject} />
        <DashboardActionCard title="New Session" description="Start a fresh agent chat in the current workspace." meta={`${sessions().length} sessions`} tone="blue" onClick={() => props.createSession()} />
        <DashboardActionCard title="Create Swarm" description="Build an AI team with orchestrator and specialist roles." meta={`${props.snapshot?.swarms.length ?? 0} swarms`} tone="warning" onClick={props.createSwarm} />
        <DashboardActionCard title="Create View" description="Open a focused multi-session view for parallel work." meta={`${props.snapshot?.views.length ?? 0} views`} tone="info" onClick={props.createView} />
      </section>
      <section class="dashboard-sections">
        <DashboardSection title="Projects" count={props.snapshot?.projects.length ?? 0} collapsed={!!collapsed().projects} onToggle={() => toggleSection("projects")} action="Refresh" onAction={props.refresh}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.projects ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create project" description="Group sessions, swarms, and views around a workspace." onClick={props.createProject} />}>
            {(project) => (
              <article class="dashboard-item-card project-card">
                <div>
                  <strong>{title(project.name ?? project.project.name)}</strong>
                  <span>{project.folders.length} folders · {projectSessions(project, props.snapshot).length} sessions</span>
                </div>
                <div class="row-actions">
                  <small>{compactPath(project.folders[0]?.path)}</small>
                  <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</button>
                  <button onClick={() => props.renameProject(project.id, project.name ?? project.project.name)}>Rename</button>
                  <button onClick={() => props.editProjectFolders(project.id, project.folders.map((folder) => folder.path))}>Folders</button>
                  <button class="danger" onClick={() => props.deleteProject(project.id, title(project.name ?? project.project.name))}>Delete</button>
                </div>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Attention Needed" count={attentionCount()} collapsed={!!collapsed().attention} onToggle={() => toggleSection("attention")}>
          <div class="dashboard-card-grid">
          <For each={props.snapshot?.permissions ?? []}>
            {(request) => (
              <button class="dashboard-item-card warning interactive" onClick={() => props.setRoute({ name: "session", sessionID: request.sessionID })}>
                <div>
                  <strong>Permission required</strong>
                  <span>{request.permission}</span>
                </div>
                <small>{request.patterns.slice(0, 2).join(", ") || "Review request"}</small>
              </button>
            )}
          </For>
          <For each={props.snapshot?.questions ?? []}>
            {(request) => (
              <button class="dashboard-item-card warning interactive" onClick={() => props.setRoute({ name: "session", sessionID: request.sessionID })}>
                <div>
                  <strong>Question pending</strong>
                  <span>{request.questions[0]?.question ?? "Agent needs input"}</span>
                </div>
                <small>{request.questions.length} questions</small>
              </button>
            )}
          </For>
          <For each={attentionJobs()}>
            {(job) => (
              <article class="dashboard-item-card warning">
                <div>
                  <strong>{title(job.title ?? job.kind)}</strong>
                  <span>{job.status}</span>
                </div>
                <small>{formatRelative(job.timeUpdated)}</small>
              </article>
            )}
          </For>
          <Show when={attentionCount() === 0}><Empty text="Nothing needs attention right now." /></Show>
          </div>
        </DashboardSection>
        <DashboardSection title="Recent Sessions" count={recentSessions().length} collapsed={!!collapsed().sessions} onToggle={() => toggleSection("sessions")}>
          <div class="dashboard-card-grid">
          <For each={recentSessions()} fallback={<EmptyCreateDashboardCard title="Create session" description="Start a new chat from the dashboard." onClick={() => props.createSession()} />}>
            {(session) => (
              <button class="dashboard-item-card interactive" onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
                <div>
                  <strong>{title(session.title)}</strong>
                  <span>{compactPath(session.directory)}</span>
                </div>
                <footer>
                  <small>{formatRelative(session.time.updated)}</small>
                  <StatusPill status={props.snapshot?.sessionStatus[session.id]?.type ?? "idle"} />
                </footer>
              </button>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Swarms" count={props.snapshot?.swarms.length ?? 0} collapsed={!!collapsed().swarms} onToggle={() => toggleSection("swarms")}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create swarm" description="Build an Agent team." onClick={props.createSwarm} />}>
            {(swarm) => (
              <article class="dashboard-item-card">
                <div>
                  <strong>{title(swarm.title)}</strong>
                  <span>{swarm.roles.length} roles · {swarm.runs.length} runs</span>
                </div>
                <footer>
                  <small>{formatRelative(swarm.timeUpdated)}</small>
                  <StatusPill status={swarm.status} />
                </footer>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} collapsed={!!collapsed().views} onToggle={() => toggleSection("views")}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.views ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create view" description="Build a focused multi-session view." onClick={props.createView} />}>
            {(view) => (
              <article class="dashboard-item-card">
                <div>
                  <strong>{title(view.title)}</strong>
                  <span>{view.sessionIDs.length} sessions</span>
                </div>
                <small>{formatRelative(view.timeUpdated)}</small>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Prior Sessions" count={priorSessions().length} collapsed={!!collapsed().prior} onToggle={() => toggleSection("prior")}>
          <div class="dashboard-card-grid compact">
          <For each={priorSessions()} fallback={<Empty text="No prior sessions." />}>
            {(session) => (
              <button class="dashboard-item-card interactive compact" onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
                <div>
                  <strong>{title(session.title)}</strong>
                  <span>{compactPath(session.directory)}</span>
                </div>
                <small>{formatRelative(session.time.updated)}</small>
              </button>
            )}
          </For>
          </div>
        </DashboardSection>
      </section>
    </div>
  )
}

function DashboardActionCard(props: { title: string; description: string; meta: string; tone: "primary" | "blue" | "warning" | "info"; onClick: () => void }) {
  return (
    <button class={`dashboard-action-card ${props.tone}`} onClick={props.onClick}>
      <span class="action-plus">+</span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <small>{props.meta}</small>
    </button>
  )
}

function DashboardSection(props: { title: string; count: number; collapsed: boolean; onToggle: () => void; action?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-section">
      <header>
        <div>
          <button class="section-collapse" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>{props.collapsed ? "+" : "-"}</button>
          <h2>{props.title}</h2>
          <span>{props.count}</span>
        </div>
        <Show when={props.action && props.onAction}>
          <button class="secondary" onClick={props.onAction}>{props.action}</button>
        </Show>
      </header>
      <Show when={!props.collapsed}>{props.children}</Show>
    </section>
  )
}

function EmptyCreateDashboardCard(props: { title: string; description: string; onClick: () => void }) {
  return (
    <button class="dashboard-item-card empty-create interactive" onClick={props.onClick}>
      <strong>+ {props.title}</strong>
      <span>{props.description}</span>
      <small>create</small>
    </button>
  )
}

function OpencodeXLogo() {
  const [now, setNow] = createSignal(0)
  const ctx = logoContext()

  onMount(() => {
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 16)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="opencodex-logo" aria-label="OpencodeX">
      {LOGO.left.map((line, y) => (
        <div class="opencodex-logo-line" aria-hidden="true">
          <div class="opencodex-logo-run">{renderTuiLogoLine(line, y, "#808080", 0, now(), ctx)}</div>
          <div class="opencodex-logo-gap" />
          <div class="opencodex-logo-run">{renderTuiLogoLine(LOGO.right[y] ?? "", y, "#eeeeee", ctx.left + 1, now(), ctx)}</div>
        </div>
      ))}
    </div>
  )
}

const LOGO = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄            ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█ ▀▄▀", "█___ █__█ █__█ █^^^ ▀ ▀ ", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀    "],
}

type Rgb = { r: number; g: number; b: number }

const LOGO_THEME = {
  background: hexToRgb("#0a0a0a"),
  primary: hexToRgb("#fab283"),
  warning: hexToRgb("#f5a742"),
  peak: hexToRgb("#ffffff"),
}

const LOGO_SHIMMER = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  softWidth: 10,
  softAmp: 1.6,
  tail: 5,
  tailAmp: 0.64,
  haloWidth: 4.3,
  haloOffset: 0.6,
  haloAmp: 0.16,
  breathBase: 0.04,
  noise: 0.1,
  ambientAmp: 0.36,
  ambientCenter: 0.5,
  ambientWidth: 0.34,
  shadowMix: 0.1,
  primaryMix: 0.3,
  originX: 4.5,
  originY: 13.5,
}

function renderTuiLogoLine(line: string, y: number, inkHex: string, off: number, t: number, ctx: ReturnType<typeof logoContext>) {
  return Array.from(line).map((char, i) => {
    const x = off + i
    const charInk = x >= 40 ? LOGO_THEME.warning : hexToRgb(inkHex)
    const shadow = tint(LOGO_THEME.background, charInk, 0.25)
    const top = logoIdle(x, y * 2, t, ctx)
    const bot = logoIdle(x, y * 2 + 1, t, ctx)
    const inkTop = logoPeakTint(charInk, top)
    const inkBot = logoPeakTint(charInk, bot)
    const pulse = { peak: (top.peak + bot.peak) / 2, primary: (top.primary + bot.primary) / 2 }
    const inkTinted = logoPeakTint(charInk, pulse)
    const shadowTop = tint(shadow, LOGO_THEME.peak, Math.min(1, top.peak * LOGO_SHIMMER.shadowMix))
    const shadowBot = tint(shadow, LOGO_THEME.peak, Math.min(1, bot.peak * LOGO_SHIMMER.shadowMix))
    const shadowTinted = tint(shadow, LOGO_THEME.peak, Math.min(1, pulse.peak * LOGO_SHIMMER.shadowMix))
    const shimmer = logoShimmer(x, y, t, ctx)

    if (char === " ") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(charInk) }}>{char}</span>
    if (char === "_") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted), "background-color": rgbToCss(shade(shadowTinted, ghost(shimmer, 0.06))) }}> </span>
    if (char === "^") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>▀</span>
    if (char === "~") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowTop, ghost(shimmer, 0.05))) }}>▀</span>
    if (char === ",") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>▄</span>
    if (char === "█") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(inkBot) }}>▀</span>
    if (char === "▀") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop) }}>▀</span>
    if (char === "▄") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkBot) }}>▄</span>
    return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted) }}>{char}</span>
  })
}

function logoContext() {
  const full = LOGO.left.map((line, i) => line + " " + LOGO.right[i])
  return {
    left: LOGO.left[0]?.length ?? 0,
    full,
    span: Math.hypot(full[0]?.length ?? 0, full.length * 2) * 0.94,
  }
}

function logoIdle(x: number, pixelY: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const corners = [[0, 0], [ctx.full[0]?.length ?? 1, 0], [0, ctx.full.length * 2], [ctx.full[0]?.length ?? 1, ctx.full.length * 2]]
  const reach = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - LOGO_SHIMMER.originX, cy - LOGO_SHIMMER.originY))) + LOGO_SHIMMER.tail * 2
  const dx = x + 0.5 - LOGO_SHIMMER.originX
  const dy = pixelY - LOGO_SHIMMER.originY
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const wob1 = logoNoise(x * 0.32, pixelY * 0.25, t * 0.0005) - 0.5
  const wob2 = logoNoise(x * 0.12, pixelY * 0.08, t * 0.00022) - 0.5
  const ripple = Math.sin(angle * 3 + t * 0.0012) * 0.3
  const traveled = dist + (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * LOGO_SHIMMER.noise
  const rings = Math.max(1, Math.floor(LOGO_SHIMMER.rings))
  const values = Array.from({ length: rings }).map((_, i) => {
    const cyclePhase = (t / LOGO_SHIMMER.period + i / rings) % 1
    if (cyclePhase >= LOGO_SHIMMER.sweepFraction) return { glow: 0, peak: 0, primary: 0, ambient: 0 }
    const phase = cyclePhase / LOGO_SHIMMER.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const delta = traveled - phase * reach
    const core = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.coreWidth) ** 1.8))
    const soft = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.softWidth) ** 1.6))
    const tailRange = LOGO_SHIMMER.tail * 2.6
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
    const haloBand = Math.exp(-(Math.abs((delta + LOGO_SHIMMER.haloOffset) / LOGO_SHIMMER.haloWidth) ** 1.6))
    const d = (phase - LOGO_SHIMMER.ambientCenter) / LOGO_SHIMMER.ambientWidth
    return {
      glow: (soft * LOGO_SHIMMER.softAmp + tail * LOGO_SHIMMER.tailAmp) * eased,
      peak: (core * LOGO_SHIMMER.coreAmp + haloBand * LOGO_SHIMMER.haloAmp) * eased,
      primary: (haloBand + tail * 0.6) * eased,
      ambient: Math.abs(d) < 1 ? (1 - d * d) ** 2 * LOGO_SHIMMER.ambientAmp : 0,
    }
  })
  return {
    glow: values.reduce((sum, item) => sum + item.glow, 0) / rings,
    peak: LOGO_SHIMMER.breathBase + values.reduce((sum, item) => sum + item.ambient + item.peak, 0) / rings,
    primary: (values.reduce((sum, item) => sum + item.primary, 0) / rings) * LOGO_SHIMMER.primaryMix,
  }
}

function logoShimmer(x: number, y: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const phase = (t / LOGO_SHIMMER.period) % 1
  const head = phase * (ctx.span + LOGO_SHIMMER.tail * 2)
  const delta = Math.hypot(x + 0.5 - LOGO_SHIMMER.originX, y * 2 + 1 - LOGO_SHIMMER.originY) - head
  if (delta < -LOGO_SHIMMER.tail || delta > LOGO_SHIMMER.coreWidth) return 0
  return Math.exp(-(Math.abs(delta / LOGO_SHIMMER.haloWidth) ** 1.6)) * 0.25
}

function logoPeakTint(base: Rgb, pulse: { peak: number; primary: number }) {
  const primary = pulse.primary > 0 ? tint(base, LOGO_THEME.primary, Math.min(1, pulse.primary)) : base
  return pulse.peak > 0 ? tint(primary, LOGO_THEME.peak, Math.min(1, pulse.peak)) : primary
}

function shade(base: Rgb, n: number) {
  if (n >= 0) {
    const mid = tint(base, LOGO_THEME.primary, 0.84)
    const top = tint(LOGO_THEME.primary, LOGO_THEME.peak, 0.96)
    if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
    return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
  }
  return tint(base, LOGO_THEME.background, Math.min(0.82, -n * 0.64))
}

function ghost(n: number, scale: number) {
  if (n < 0) return n
  return n * scale
}

function tint(a: Rgb, b: Rgb, amount: number) {
  const t = Math.max(0, Math.min(1, amount))
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

function logoNoise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function hexToRgb(hex: string) {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) }
}

function rgbToCss(rgb: Rgb) {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`
}

function SessionPage(props: {
  session?: Session
  data: SessionData
  loading: boolean
  prompt: string
  setPrompt: (value: string) => void
  providers: Provider[]
  agents: Agent[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  recentModels: string[]
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  submit: (event: SubmitEvent) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  status?: string
}) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let transcript: HTMLElement | undefined
  let composerTextarea: HTMLTextAreaElement | undefined
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  const [modelQuery, setModelQuery] = createSignal("")
  const modelOptions = createMemo(() =>
    props.providers.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .map((model) => ({ provider, model })),
    ),
  )
  const recentModelOptions = createMemo(() =>
    props.recentModels.flatMap((value) => {
      const option = modelOptions().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  const providerModelOptions = createMemo(() => {
    const recents = new Set(recentModelOptions().map((item) => modelValue(item.provider.id, item.model.id)))
    return props.providers
      .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
      .map((provider) => ({
        provider,
        models: Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .filter((model) => !recents.has(modelValue(provider.id, model.id)))
          .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      }))
      .filter((item) => item.models.length > 0)
  })
  const filteredRecentModelOptions = createMemo(() => filterModelOptions(recentModelOptions(), modelQuery()))
  const filteredProviderModelOptions = createMemo(() =>
    providerModelOptions()
      .map((group) => ({ ...group, models: filterModelOptions(group.models.map((model) => ({ provider: group.provider, model })), modelQuery()).map((item) => item.model) }))
      .filter((group) => group.models.length > 0),
  )
  const activeProvider = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)
  })
  const activeModel = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]
  })
  const variants = createMemo(() => Object.keys(activeModel()?.variants ?? {}))
  const mode = createMemo(() => props.selectedAgent === "plan" ? "plan" : "build")
  const sessionStarted = createMemo(() => props.loading || props.data.messages.length > 0 || props.status === "busy" || props.status === "retry" || blocked())
  const modelLabel = () => props.selectedModel && activeProvider() && activeModel() ? `${activeModel()!.name ?? activeModel()!.id} ${activeProvider()!.name}` : "Select model"
  const variantLabel = () => props.selectedVariant || "Default"
  const toggleMode = () => props.setSelectedAgent(mode() === "plan" ? "build" : "plan")
  const selectVariant = (variant: string) => {
    props.setSelectedVariant(variant)
    setVariantPickerOpen(false)
  }
  const cycleVariant = () => {
    const list = variants()
    if (list.length === 0) return
    const options = ["", ...list]
    const index = options.indexOf(props.selectedVariant)
    props.setSelectedVariant(options[index >= 0 ? (index + 1) % options.length : 1])
    setVariantPickerOpen(false)
  }
  const selectModel = (providerID: string, modelID: string) => {
    props.setSelectedModel(modelValue(providerID, modelID))
    setModelPickerOpen(false)
    setVariantPickerOpen(false)
    setModelQuery("")
  }
  createEffect(() => {
    props.prompt
    if (!composerTextarea) return
    composerTextarea.style.height = "auto"
    composerTextarea.style.height = `${composerTextarea.scrollHeight}px`
  })
  createEffect(() => {
    const id = props.session?.id
    const count = props.data.messages.reduce((total, message) => total + message.parts.length, 0)
    if (!id && count === 0) return
    requestAnimationFrame(() => {
      if (transcript) transcript.scrollTop = transcript.scrollHeight
    })
  })
  return (
    <div class="page session-page" classList={{ "session-empty": !sessionStarted() }}>
      <Show when={session()} fallback={<Empty text="Session not found" />}>
        {(selected) => (
          <>
            <header class="session-toolbar">
              <div class="session-titleline">
                <div>
                  <h1>{title(selected().title)}</h1>
                  <p>{compactPath(selected().directory)}</p>
                </div>
              </div>
              <div class="session-actions compact">
                <Show when={props.status === "busy" || props.status === "retry" || blocked()}>
                  <button class="icon-button" title="Interrupt session" aria-label="Interrupt session" onClick={() => props.abortSession(selected().id)}><Icon name="stop" /></button>
                </Show>
                <StatusPill status={blocked() ? "input_needed" : props.status ?? "idle"} />
                <details class="overflow-menu">
                  <summary title="Session actions" aria-label="Session actions"><Icon name="more" /></summary>
                  <div>
                    <button type="button" onClick={() => props.renameSession(selected())}>Rename</button>
                    <button type="button" onClick={() => props.moveSession(selected())}>Move to project</button>
                    <button type="button" class="danger" onClick={() => props.deleteSession(selected())}>Delete</button>
                  </div>
                </details>
              </div>
            </header>
            <For each={props.permissions}>
              {(request) => <PermissionPanel request={request} tool={permissionToolPart(request, props.data.messages)} reply={props.replyPermission} />}
            </For>
            <For each={props.questions}>
              {(request) => <QuestionPanel request={request} reply={props.replyQuestion} reject={props.rejectQuestion} />}
            </For>
            <section class="transcript" ref={transcript}>
              <SessionSideData todos={props.data.todos} diffs={props.data.diffs} />
              <Show when={!props.loading} fallback={<TranscriptLoadingState />}>
                <For each={props.data.messages} fallback={<SessionEmptyState />}>
                  {(bundle) => (
                    <article class={`message ${bundle.info.role}`}>
                      <header>{bundle.info.role}</header>
                      <For each={bundle.parts}>
                        {(part) => <PartView part={part} />}
                      </For>
                    </article>
                  )}
                </For>
              </Show>
            </section>
            <form class="composer" onSubmit={props.submit}>
              <div class={`composer-input ${mode()}`}>
                <textarea
                  ref={composerTextarea}
                  disabled={blocked()}
                  value={props.prompt}
                  onInput={(event) => {
                    props.setPrompt(event.currentTarget.value)
                    event.currentTarget.style.height = "auto"
                    event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`
                  }}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key.toLowerCase() === "t") {
                      event.preventDefault()
                      if (!blocked()) cycleVariant()
                      return
                    }
                    if (event.key === "Tab") {
                      event.preventDefault()
                      if (!blocked()) toggleMode()
                      return
                    }
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
                  placeholder={blocked() ? "Reply to the pending permission/question before continuing..." : "Message OpencodeX..."}
                />
                <div class="composer-footer">
                  <div class="composer-meta" aria-live="polite">
                    <button class={`mode-chip ${mode()}`} type="button" disabled={blocked()} onClick={toggleMode} title="Toggle Build/Plan mode">
                      {mode() === "plan" ? "Plan" : "Build"}
                    </button>
                    <button class="model-menu" type="button" disabled={blocked()} onClick={() => setModelPickerOpen(true)} title="Choose model">{modelLabel()}</button>
                    <Show when={variants().length > 0}>
                      <div
                        class="variant-menu-wrap"
                        onFocusOut={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setVariantPickerOpen(false)
                        }}
                      >
                        <button
                          class="variant-trigger"
                          type="button"
                          disabled={blocked()}
                          aria-haspopup="listbox"
                          aria-expanded={variantPickerOpen()}
                          title="Change variant (Ctrl+T to cycle)"
                          onClick={() => setVariantPickerOpen((open) => !open)}
                        >
                          {variantLabel()}
                        </button>
                        <Show when={variantPickerOpen()}>
                          <div class="variant-menu" role="listbox" aria-label="Choose variant">
                            <button type="button" role="option" aria-selected={props.selectedVariant === ""} classList={{ selected: props.selectedVariant === "" }} onClick={() => selectVariant("")}>Default</button>
                            <For each={variants()}>
                              {(variant) => (
                                <button type="button" role="option" aria-selected={props.selectedVariant === variant} classList={{ selected: props.selectedVariant === variant }} onClick={() => selectVariant(variant)}>
                                  {variant}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <button class="send-button" type="submit" title="Send message" aria-label="Send message" disabled={blocked() || props.prompt.trim().length === 0}>
                    <Icon name="send" />
                  </button>
                </div>
              </div>
            </form>
            <Show when={modelPickerOpen()}>
              <div class="dialog-backdrop" onMouseDown={() => setModelPickerOpen(false)}>
                <section class="model-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
                  <header>
                    <div>
                      <h2>Select model</h2>
                      <p>Recent routes are listed first, matching the TUI picker.</p>
                    </div>
                    <button type="button" aria-label="Close model picker" onClick={() => setModelPickerOpen(false)}>×</button>
                  </header>
                  <input value={modelQuery()} onInput={(event) => setModelQuery(event.currentTarget.value)} placeholder="Search models or providers" autofocus />
                  <div class="model-picker-list">
                    <Show when={filteredRecentModelOptions().length > 0}>
                      <ModelPickerSection title="Recently used" selectedModel={props.selectedModel} options={filteredRecentModelOptions()} select={selectModel} />
                    </Show>
                    <For each={filteredProviderModelOptions()}>
                      {(group) => (
                        <ModelPickerSection
                          title={group.provider.name}
                          selectedModel={props.selectedModel}
                          options={group.models.map((model) => ({ provider: group.provider, model }))}
                          select={selectModel}
                        />
                      )}
                    </For>
                    <Show when={filteredRecentModelOptions().length === 0 && filteredProviderModelOptions().length === 0}>
                      <p class="model-picker-empty">No matching models.</p>
                    </Show>
                  </div>
                </section>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

type ModelPickerOption = { provider: Provider; model: Provider["models"][string] }

function ModelPickerSection(props: { title: string; selectedModel: string; options: ModelPickerOption[]; select: (providerID: string, modelID: string) => void }) {
  return (
    <section class="model-picker-section">
      <h3>{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => {
            const value = modelValue(option.provider.id, option.model.id)
            return (
              <button type="button" classList={{ selected: props.selectedModel === value }} onClick={() => props.select(option.provider.id, option.model.id)}>
                <span>{option.model.name ?? option.model.id}</span>
                <small>{option.provider.name}</small>
                <Show when={isFreeOpencodeModel(option.provider, option.model)}><em>Free</em></Show>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}

function filterModelOptions(options: ModelPickerOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => `${option.model.name ?? option.model.id} ${option.provider.name}`.toLowerCase().includes(needle))
}

function isFreeOpencodeModel(provider: Provider, model: Provider["models"][string]) {
  return provider.id === "opencode" && model.cost?.input === 0
}

function PermissionPanel(props: { request: PermissionRequest; tool?: Extract<Part, { type: "tool" }>; reply: (request: PermissionRequest, reply: "once" | "always" | "reject") => void }) {
  const input = () => toolInput(props.request, props.tool)
  return (
    <section class="safety-panel permission-panel">
      <div>
        <p class="eyebrow">Permission Required</p>
        <h2>{permissionTitle(props.request, input())}</h2>
        <Show when={props.request.patterns.length > 0}>
          <p>Patterns: {props.request.patterns.join(", ")}</p>
        </Show>
        <Show when={props.tool}>
          {(tool) => (
            <details class="permission-context" open>
              <summary>Tool Context: {tool().tool}</summary>
              <Show when={Object.keys(input()).length > 0}>
                <pre>{JSON.stringify(input(), null, 2)}</pre>
              </Show>
              <Show when={toolOutput(tool().state)}>
                {(output) => <pre>{collapseOutput(output()).output}</pre>}
              </Show>
              <Show when={toolError(tool().state)}>
                {(error) => <pre>{error()}</pre>}
              </Show>
            </details>
          )}
        </Show>
        <Show when={permissionDiff(props.request)}>
          {(diff) => (
            <details class="permission-context" open>
              <summary>Requested Diff</summary>
              <pre>{diff()}</pre>
            </details>
          )}
        </Show>
        <Show when={Object.keys(props.request.metadata).length > 0}>
          <details class="permission-context">
            <summary>Raw Metadata</summary>
            <pre>{JSON.stringify(props.request.metadata, null, 2)}</pre>
          </details>
        </Show>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reply(props.request, "reject")}>Reject</button>
        <button class="secondary" onClick={() => props.reply(props.request, "once")}>Allow Once</button>
        <button class="primary" onClick={() => props.reply(props.request, "always")}>Always Allow</button>
      </div>
    </section>
  )
}

function QuestionPanel(props: { request: QuestionRequest; reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void; reject: (request: QuestionRequest) => void }) {
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createSignal<string[]>(props.request.questions.map(() => ""))
  const finalAnswers = () =>
    answers().map((answer, index) => {
      const text = custom()[index]?.trim()
      if (!text) return answer
      return [...answer, text]
    })
  const valid = () => finalAnswers().every((answer) => answer.length > 0)
  function toggle(index: number, label: string, multiple?: boolean) {
    setAnswers((current) =>
      current.map((answer, i) => {
        if (i !== index) return answer
        if (!multiple) return [label]
        if (answer.includes(label)) return answer.filter((item) => item !== label)
        return [...answer, label]
      }),
    )
  }
  function updateCustom(index: number, value: string) {
    setCustom((current) => current.map((item, i) => (i === index ? value : item)))
  }
  return (
    <section class="safety-panel question-panel">
      <div>
        <p class="eyebrow">Question Pending</p>
        <For each={props.request.questions}>
          {(question, index) => (
            <div class="question-block">
              <h2>{question.header}</h2>
              <p>{question.question}</p>
              <div class="option-list">
                <For each={question.options}>
                  {(option) => (
                    <button
                      classList={{ selected: answers()[index()].includes(option.label) }}
                      onClick={() => toggle(index(), option.label, question.multiple)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={question.custom !== false}>
                <input
                  class="custom-answer"
                  value={custom()[index()] ?? ""}
                  onInput={(event) => updateCustom(index(), event.currentTarget.value)}
                  placeholder="Type a custom answer"
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reject(props.request)}>Reject</button>
        <button class="primary" disabled={!valid()} onClick={() => props.reply(props.request, finalAnswers())}>Reply</button>
      </div>
    </section>
  )
}

function SessionSideData(props: { todos: Todo[]; diffs: SnapshotFileDiff[] }) {
  return (
    <Show when={props.todos.length > 0 || props.diffs.length > 0}>
      <section class="session-side-data">
        <Show when={props.todos.length > 0}>
          <div>
            <h3>Todos</h3>
            <For each={props.todos}>
              {(todo) => (
                <div class={`todo-item ${todo.status}`}>
                  <span>{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "•" : " "}</span>
                  <strong>{todo.content}</strong>
                  <small>{todo.priority}</small>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.diffs.length > 0}>
          <div>
            <h3>File Changes</h3>
            <For each={props.diffs}>
              {(diff) => (
                <details class="diff-item">
                  <summary>
                    <span>{diff.status ?? "modified"}</span>
                    <strong>{diff.file ?? "Unknown file"}</strong>
                    <small>+{diff.additions} -{diff.deletions}</small>
                  </summary>
                  <Show when={diff.patch}>
                    <pre>{diff.patch}</pre>
                  </Show>
                </details>
              )}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  )
}

function PartView(props: { part: MessageBundle["parts"][number] }) {
  return (
    <Switch fallback={<pre class="part muted">{JSON.stringify(props.part, null, 2)}</pre>}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <TextPartView part={props.part as Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>} />
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolPartView part={props.part as Extract<Part, { type: "tool" }>} />
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="part file">File: {props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</div>
      </Match>
      <Match when={props.part.type === "agent"}>
        <div class="part badge">Agent: {props.part.type === "agent" ? props.part.name : ""}</div>
      </Match>
      <Match when={props.part.type === "patch"}>
        <div class="part badge">Patch: {props.part.type === "patch" ? props.part.files.join(", ") : ""}</div>
      </Match>
      <Match when={props.part.type === "compaction"}>
        <div class="part badge">Compaction {props.part.type === "compaction" && props.part.auto ? "auto" : "manual"}</div>
      </Match>
    </Switch>
  )
}

function isStructuralPart(part: MessageBundle["parts"][number]) {
  return part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot" || part.type === "retry" || part.type === "subtask"
}

function TextPartView(props: { part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }> }) {
  const text = createMemo(() => {
    if ("synthetic" in props.part && props.part.synthetic) return ""
    if ("ignored" in props.part && props.part.ignored) return ""
    return displayMessageText(props.part.text).trim()
  })
  return (
    <Show when={text()}>
      <div class={`part text ${props.part.type}`}>
        <Show when={props.part.type === "reasoning"} fallback={<Markdown text={text()} cacheKey={props.part.id} streaming={false} />}>
          <details class="thinking-block" open>
            <summary>Thinking</summary>
            <Markdown text={text()} cacheKey={props.part.id} streaming={false} />
          </details>
        </Show>
      </div>
    </Show>
  )
}

function ToolPartView(props: { part: Extract<Part, { type: "tool" }> }) {
  const state = () => props.part.state
  const input = createMemo(() => toolStateInput(state()))
  const metadata = createMemo(() => toolMetadata(state()) ?? {})
  const output = createMemo(() => toolVisibleOutput(props.part.tool, state(), metadata()))
  const error = createMemo(() => toolError(state()))
  const title = createMemo(() => toolDisplayTitle(props.part.tool, input(), metadata()))
  const open = createMemo(() => state().status === "running" || state().status === "error" || Boolean(output() || toolHasRichDetails(props.part.tool, metadata(), input())))
  return (
    <details class={`part tool ${state().status}`} open={open()}>
      <summary>
        <strong>{title()}</strong>
        <span>{state().status}</span>
      </summary>
      <Show when={toolTitle(state())}>
        <p>{toolTitle(state())}</p>
      </Show>
      <ToolDetails tool={props.part.tool} input={input()} metadata={metadata()} output={output()} error={error()} />
      <Show when={Object.keys(input()).length > 0 || Object.keys(metadata()).length > 0}>
        <details class="tool-raw">
          <summary>Raw tool data</summary>
          <Show when={Object.keys(input()).length > 0}>
            <label>Input</label>
            <pre>{JSON.stringify(input(), null, 2)}</pre>
          </Show>
          <Show when={Object.keys(metadata()).length > 0}>
            <label>Metadata</label>
            <pre>{JSON.stringify(metadata(), null, 2)}</pre>
          </Show>
        </details>
      </Show>
    </details>
  )
}

function ToolDetails(props: { tool: string; input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  const diagnostics = createMemo(() => arrayValue(props.metadata.diagnostics))
  return (
    <div class="tool-details">
      <Switch fallback={<GenericToolDetails input={props.input} metadata={props.metadata} output={props.output} error={props.error} />}>
        <Match when={props.tool === "bash" || props.tool === "shell"}>
          <ToolKeyValues values={[field("description", props.input.description), field("workdir", props.input.workdir)]} />
          <Show when={stringValue(props.input.command)}>
            {(command) => <pre class="tool-command">$ {command()}</pre>}
          </Show>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "grep" || props.tool === "glob"}>
          <ToolKeyValues values={[field("pattern", props.input.pattern), field("path", props.input.path), field("include", props.input.include), field("matches", props.metadata.matches), field("count", props.metadata.count)]} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "read"}>
          <ToolKeyValues values={[field("file", props.input.filePath), field("offset", props.input.offset), field("limit", props.input.limit)]} />
          <ToolLoadedFiles metadata={props.metadata} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "write"}>
          <ToolKeyValues values={[field("file", props.input.filePath)]} />
          <Show when={stringValue(props.input.content)}>
            {(content) => <pre class="tool-code">{content()}</pre>}
          </Show>
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "edit"}>
          <ToolKeyValues values={[field("file", props.input.filePath), field("replaceAll", props.input.replaceAll)]} />
          <ToolDiffs metadata={props.metadata} />
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "apply_patch"}>
          <ToolDiffs metadata={props.metadata} />
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "todowrite"}>
          <ToolTodos input={props.input} metadata={props.metadata} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "question"}>
          <ToolQuestions input={props.input} metadata={props.metadata} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "task"}>
          <ToolKeyValues values={[field("description", props.input.description), field("agent", props.input.subagent_type), field("session", props.metadata.sessionId), field("background", props.metadata.background)]} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "webfetch" || props.tool === "websearch"}>
          <ToolKeyValues values={[field("url", props.input.url), field("query", props.input.query), field("format", props.input.format), field("results", props.metadata.numResults), field("provider", props.metadata.provider)]} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "skill"}>
          <ToolKeyValues values={[field("skill", props.input.name)]} />
          <ToolOutput output={props.output} />
        </Match>
      </Switch>
      <Show when={props.error}>
        {(error) => <pre class="tool-error">{error()}</pre>}
      </Show>
    </div>
  )
}

function GenericToolDetails(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  return (
    <>
      <ToolKeyValues values={Object.entries(props.input).slice(0, 8).map(([key, value]) => field(key, value))} />
      <ToolOutput output={props.output} />
    </>
  )
}

function ToolKeyValues(props: { values: Array<{ label: string; value: unknown }> }) {
  const values = createMemo(() => props.values.filter((item) => item.value !== undefined && item.value !== null && item.value !== ""))
  return (
    <Show when={values().length > 0}>
      <dl class="tool-kv">
        <For each={values()}>
          {(item) => (
            <div>
              <dt>{item.label}</dt>
              <dd>{formatToolValue(item.value)}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  )
}

function ToolOutput(props: { output: string }) {
  const [expanded, setExpanded] = createSignal(false)
  const collapsed = createMemo(() => collapseOutput(props.output.trim(), 80, 16_000))
  const visible = createMemo(() => expanded() || !collapsed().overflow ? props.output.trim() : collapsed().output)
  return (
    <Show when={props.output.trim()}>
      <div class="tool-output">
        <header>Output</header>
        <pre>{visible()}</pre>
        <Show when={collapsed().overflow}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? "Show less" : "Show more"}</button>
        </Show>
      </div>
    </Show>
  )
}

function ToolDiffs(props: { metadata: Record<string, unknown> }) {
  const files = createMemo(() => arrayValue(props.metadata.files).filter(isRecordValue))
  return (
    <>
      <Show when={stringValue(props.metadata.diff)}>
        {(diff) => <ToolDiff title="Diff" diff={diff()} />}
      </Show>
      <For each={files()}>
        {(file) => {
          const patch = stringValue(file.patch)
          const name = stringValue(file.relativePath) ?? stringValue(file.filePath) ?? stringValue(file.movePath) ?? "file"
          const type = stringValue(file.type)
          return (
            <Show when={patch || type === "delete"}>
              <ToolDiff title={toolPatchTitle(type, name, file)} diff={patch ?? `-${numberValue(file.deletions) ?? 0} lines`} />
            </Show>
          )
        }}
      </For>
    </>
  )
}

function ToolDiff(props: { title: string; diff: string }) {
  return (
    <details class="tool-diff" open>
      <summary>{props.title}</summary>
      <pre>{props.diff}</pre>
    </details>
  )
}

function ToolDiagnostics(props: { diagnostics: unknown[] }) {
  return (
    <Show when={props.diagnostics.length > 0}>
      <details class="tool-diagnostics" open>
        <summary>Diagnostics ({props.diagnostics.length})</summary>
        <pre>{JSON.stringify(props.diagnostics, null, 2)}</pre>
      </details>
    </Show>
  )
}

function ToolLoadedFiles(props: { metadata: Record<string, unknown> }) {
  const loaded = createMemo(() => arrayValue(props.metadata.loaded).filter((item): item is string => typeof item === "string"))
  return (
    <Show when={loaded().length > 0}>
      <div class="tool-list">
        <header>Loaded</header>
        <For each={loaded()}>{(item) => <p>Loaded {item}</p>}</For>
      </div>
    </Show>
  )
}

function ToolTodos(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const todos = createMemo(() => arrayValue(props.metadata.todos).length > 0 ? arrayValue(props.metadata.todos) : arrayValue(props.input.todos))
  return (
    <Show when={todos().length > 0}>
      <div class="tool-todos">
        <For each={todos().filter(isRecordValue)}>
          {(todo) => <div class={`todo-item ${stringValue(todo.status) ?? "pending"}`}><span>{todoIcon(stringValue(todo.status))}</span><strong>{stringValue(todo.content) ?? "Todo"}</strong><small>{stringValue(todo.priority) ?? ""}</small></div>}
        </For>
      </div>
    </Show>
  )
}

function ToolQuestions(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const questions = createMemo(() => arrayValue(props.input.questions).filter(isRecordValue))
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  return (
    <Show when={questions().length > 0}>
      <div class="tool-questions">
        <For each={questions()}>
          {(question, index) => <div><strong>{stringValue(question.question) ?? stringValue(question.header) ?? "Question"}</strong><p>{formatToolValue(answers()[index()] ?? "No answer")}</p></div>}
        </For>
      </div>
    </Show>
  )
}

function toolStateInput(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("input" in state && isRecordValue(state.input)) return state.input
  return {}
}

function toolVisibleOutput(tool: string, state: Extract<Part, { type: "tool" }>["state"], metadata: Record<string, unknown>) {
  const output = toolOutput(state)
  if (output) return tool === "bash" || tool === "shell" ? stripAnsiBasic(output) : output
  if ((tool === "bash" || tool === "shell") && typeof metadata.output === "string") return stripAnsiBasic(metadata.output)
  return ""
}

function toolDisplayTitle(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (tool === "bash" || tool === "shell") return stringValue(input.description) ?? stringValue(input.command) ?? "Shell"
  if (tool === "grep") return `Grep ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.matches, "match")}`
  if (tool === "glob") return `Glob ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.count, "match")}`
  if (tool === "read") return `Read ${stringValue(input.filePath) ?? "file"}`
  if (tool === "write") return `Write ${stringValue(input.filePath) ?? "file"}`
  if (tool === "edit") return `Edit ${stringValue(input.filePath) ?? "file"}`
  if (tool === "apply_patch") return "Apply patch"
  if (tool === "todowrite") return "Update todos"
  if (tool === "question") return `Ask ${arrayValue(input.questions).length || ""} question${arrayValue(input.questions).length === 1 ? "" : "s"}`.trim()
  if (tool === "task") return `${stringValue(input.subagent_type) ?? "General"} task: ${stringValue(input.description) ?? "subagent"}`
  if (tool === "webfetch") return `WebFetch ${stringValue(input.url) ?? ""}`.trim()
  if (tool === "websearch") return `WebSearch ${quoteValue(input.query)}`
  if (tool === "skill") return `Skill ${stringValue(input.name) ?? ""}`.trim()
  return tool
}

function toolHasRichDetails(tool: string, metadata: Record<string, unknown>, input: Record<string, unknown>) {
  return Boolean(
    stringValue(metadata.diff) ||
    arrayValue(metadata.files).length ||
    arrayValue(metadata.loaded).length ||
    arrayValue(metadata.todos).length ||
    arrayValue(input.todos).length ||
    arrayValue(input.questions).length ||
    stringValue(input.content),
  )
}

function field(label: string, value: unknown) {
  return { label, value }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(formatToolValue).join(", ")
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

function quoteValue(value: unknown) {
  const text = stringValue(value)
  return text ? `"${text}"` : ""
}

function inPath(value: unknown) {
  const path = stringValue(value)
  return path ? ` in ${path}` : ""
}

function countSuffix(value: unknown, noun: string) {
  const count = numberValue(value)
  if (!count) return ""
  return ` (${count} ${noun}${count === 1 ? "" : "es"})`
}

function toolPatchTitle(type: string | undefined, name: string, file: Record<string, unknown>) {
  if (type === "delete") return `Deleted ${name}`
  if (type === "add") return `Created ${name}`
  if (type === "move") return `Moved ${stringValue(file.filePath) ?? name} -> ${name}`
  return `Patched ${name}`
}

function todoIcon(status: string | undefined) {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "•"
  return " "
}

function toolTitle(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("title" in state) return state.title
}

function toolOutput(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "completed") return state.output
}

function toolError(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "error") return state.error
}

function toolMetadata(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("metadata" in state && isRecordValue(state.metadata)) return state.metadata
}

function stripAnsiBasic(text: string) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function permissionToolPart(request: PermissionRequest, messages: MessageBundle[]) {
  if (!request.tool) return
  return messages
    .flatMap((message) => message.parts)
    .find((part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.callID === request.tool?.callID && part.messageID === request.tool.messageID)
}

function toolInput(request: PermissionRequest, part?: Extract<Part, { type: "tool" }>) {
  if (part && "input" in part.state && part.state.input && typeof part.state.input === "object") return part.state.input as Record<string, unknown>
  return request.metadata
}

function permissionTitle(request: PermissionRequest, input: Record<string, unknown>) {
  if (request.permission === "edit" && typeof request.metadata.filepath === "string") return `Edit ${request.metadata.filepath}`
  if (request.permission === "read" && typeof input.filePath === "string") return `Read ${input.filePath}`
  if (request.permission === "glob" && typeof input.pattern === "string") return `Glob ${input.pattern}`
  if (request.permission === "grep" && typeof input.pattern === "string") return `Grep ${input.pattern}`
  if (request.permission === "list" && typeof input.path === "string") return `List ${input.path}`
  if (request.permission === "bash" && typeof input.command === "string") return input.command
  if (request.permission === "task" && typeof input.description === "string") return `Task: ${input.description}`
  if (request.permission === "webfetch" && typeof input.url === "string") return `WebFetch ${input.url}`
  if (request.permission === "websearch" && typeof input.query === "string") return `WebSearch ${input.query}`
  if (request.permission === "external_directory") return "Access external directory"
  if (request.permission === "doom_loop") return "Continue after repeated failures"
  return request.permission
}

function permissionDiff(request: PermissionRequest) {
  if (typeof request.metadata.diff === "string") return request.metadata.diff
}

function collapseOutput(output: string, maxLines = 120, maxChars = 12_000) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return { output, overflow: false }
  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) return { output: `${Array.from(preview).slice(0, Math.max(0, maxChars - 3)).join("")}...`, overflow: true }
  return { output: [...lines.slice(0, maxLines), "..."].join("\n"), overflow: true }
}

function modelValue(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function parseModelValue(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

function isTUISidebarSession(session: Session) {
  return !session.parentID && !isSwarmSession(session)
}

function isSwarmSession(session: Session) {
  const opencodex = session.metadata?.opencodex
  return typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string"
}

function tuiSidebarSessions(snapshot?: GuiSnapshot) {
  return (snapshot?.sessions ?? []).filter(isTUISidebarSession).toSorted((a, b) => b.time.updated - a.time.updated)
}

function projectSessions(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  const byID = new Map(tuiSidebarSessions(snapshot).map((session) => [session.id, session]))
  return project.sessions
    .filter(isTUISidebarSession)
    .map((session) => byID.get(session.id) ?? session)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

function recentProjectSessions(sessions: Session[]) {
  const sorted = sessions.filter(isTUISidebarSession).toSorted((a, b) => b.time.updated - a.time.updated)
  const recent = sorted.filter((session) => isRecentSessionUpdate(session.time.updated))
  return recent.length >= PROJECT_RECENT_SESSION_LIMIT ? recent : sorted.slice(0, PROJECT_RECENT_SESSION_LIMIT)
}

function sidebarStatus(snapshot: GuiSnapshot | undefined, session: Session) {
  if ((snapshot?.permissions ?? []).some((request) => request.sessionID === session.id) || (snapshot?.questions ?? []).some((request) => request.sessionID === session.id)) return "input_needed"
  const status = snapshot?.sessionStatus[session.id]?.type
  if (status === "busy" || status === "retry") return "in_progress"
  return "dormant"
}

function sidebarDisplayStatus(snapshot: GuiSnapshot | undefined, session: Session, lastViewed: number) {
  const status = sidebarStatus(snapshot, session)
  if (status === "dormant" && session.time.updated > lastViewed) return "unviewed"
  return status
}

function sidebarStatusLabel(status: string) {
  if (status === "in_progress") return "running"
  if (status === "input_needed") return "needs input"
  if (status === "unviewed") return "waiting for user to view"
  if (status === "failed") return "failed"
  return "idle"
}

function SidebarSessionLink(props: { session: Session; snapshot?: GuiSnapshot; lastViewed: number; active: boolean; nested?: boolean; onClick: () => void }) {
  const status = createMemo(() => sidebarDisplayStatus(props.snapshot, props.session, props.lastViewed))
  const subtitle = createMemo(() => [props.session.model?.id?.slice((props.session.model?.id ?? "").lastIndexOf("/") + 1), formatRelative(props.session.time.updated)].filter(Boolean).join(" - "))
  return (
    <button
      title={`${title(props.session.title)} - ${sidebarStatusLabel(status())} - ${formatRelative(props.session.time.updated)}`}
      class="session-link"
      classList={{ active: props.active, nested: props.nested, [`status-${status().replaceAll("_", "-")}`]: true }}
      onClick={props.onClick}
    >
      <span>{title(props.session.title)}</span>
      <small>
        <span>{subtitle()}</span>
      </small>
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "unviewed"}><span class="status-glyph" aria-label={sidebarStatusLabel(status())} /></Show>
    </button>
  )
}

function moveByOffset(ids: string[], sourceID: string, offset: number) {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = sourceIndex + offset
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= ids.length) return []
  return ids.map((id, index) => (index === sourceIndex ? ids[targetIndex] : index === targetIndex ? sourceID : id))
}

function moveRelative(ids: string[], sourceID: string, targetID: string, placement: "before" | "after") {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = ids.indexOf(targetID)
  if (sourceIndex === -1 || targetIndex === -1) return []
  const withoutSource = ids.filter((id) => id !== sourceID)
  const insertionIndex = withoutSource.indexOf(targetID) + (placement === "after" ? 1 : 0)
  return [...withoutSource.slice(0, insertionIndex), sourceID, ...withoutSource.slice(insertionIndex)]
}

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

function StatusDot(props: { status: string }) {
  return <span class={`status-dot ${props.status.replaceAll("_", "-")}`} aria-label={props.status} />
}

function confirmedSessionStatus(current: GuiSnapshot["sessionStatus"], next: GuiSnapshot["sessionStatus"], idleSessionID?: string) {
  const status = { ...current, ...next }
  if (idleSessionID && !next[idleSessionID]) delete status[idleSessionID]
  return status
}

function eventSessionID(event: GlobalEvent) {
  if ("properties" in event.payload) {
    const sessionID = sessionIDFrom(event.payload.properties)
    if (sessionID) return sessionID
  }
  if (!("data" in event.payload)) return
  return sessionIDFrom(event.payload.data)
}

function sessionIDFrom(value: unknown) {
  if (typeof value !== "object" || value === null || !("sessionID" in value)) return
  const sessionID = value.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function recentModelsFromSessions(sessions: Session[]) {
  return mergeRecentModels(
    sessions
      .filter((session) => session.model)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => modelValue(session.model!.providerID, session.model!.id)),
  )
}

function mergeRecentModels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).slice(0, 10)
}

function firstAvailableModel(providers: Provider[]) {
  const provider = providers
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .find((item) => Object.values(item.models).some((model) => model.status !== "deprecated"))
  const model = provider ? Object.values(provider.models).filter((item) => item.status !== "deprecated").toSorted((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))[0] : undefined
  if (!provider || !model) return undefined
  return modelValue(provider.id, model.id)
}

function readRecentModels() {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem("opencodex.gui.recentModels")
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(0, 10)
  } catch {
    return []
  }
}

function writeRecentModels(values: string[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.recentModels", JSON.stringify(values.slice(0, 10)))
  } catch {
    return
  }
}

function readViewedSessions() {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem("opencodex.gui.viewedSessions")
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
  } catch {
    return {}
  }
}

function writeViewedSessions(values: Record<string, number>) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.viewedSessions", JSON.stringify(values))
  } catch {
    return
  }
}

function SessionCollectionPage(props: { snapshot?: GuiSnapshot; setRoute: (route: Route) => void }) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <h1>Session workspace</h1>
      <p>Open, monitor, and resume existing TUI-compatible sessions from the shared backend data model.</p>
      <For each={sessions()} fallback={<Empty text="No sessions" />}>
        {(session) => (
          <button class="card-row interactive" onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
            <div>
              <strong>{title(session.title)}</strong>
              <span>{compactPath(session.directory)}</span>
            </div>
            <StatusPill status={props.snapshot?.sessionStatus[session.id]?.type ?? "idle"} />
          </button>
        )}
      </For>
    </div>
  )
}

function ProjectCollectionPage(props: { snapshot?: GuiSnapshot; createSession: (projectID?: string, directory?: string) => void }) {
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Projects</p>
      <h1>Project groups</h1>
      <p>Project groups, folders, and nested sessions are loaded from the same OpencodeX backend used by the TUI.</p>
      <For each={props.snapshot?.projects ?? []} fallback={<Empty text="No projects" />}>
        {(project) => (
          <article class="card-row">
            <div>
              <strong>{title(project.name ?? project.project.name)}</strong>
              <span>{project.folders.map((folder) => compactPath(folder.path)).join(", ")}</span>
            </div>
            <div class="row-actions">
              <small>{projectSessions(project, props.snapshot).length} sessions</small>
              <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</button>
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

function StatusPage(props: { snapshot?: GuiSnapshot }) {
  const activeProviders = createMemo(() => props.snapshot?.providers.filter((provider) => Object.values(provider.models).some((model) => model.status !== "deprecated")).length ?? 0)
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Status</p>
      <h1>Runtime status</h1>
      <p>Provider, model, agent, session, and safety status surfaces are loaded through existing OpencodeX endpoints.</p>
      <section class="metric-grid">
        <Metric label="Providers" value={activeProviders()} />
        <Metric label="Models" value={props.snapshot?.providers.flatMap((provider) => Object.values(provider.models)).filter((model) => model.status !== "deprecated").length ?? 0} />
        <Metric label="Agents" value={props.snapshot?.agents.length ?? 0} />
        <Metric label="Active Sessions" value={Object.values(props.snapshot?.sessionStatus ?? {}).filter((status) => status.type !== "idle").length} />
        <Metric label="Input Needed" value={(props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0)} />
      </section>
    </div>
  )
}

function CollectionPage(props: { title: string; count: number; description: string }) {
  return (
    <div class="page placeholder-page">
      <p class="eyebrow">Parity area</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      <div class="metric-card large"><strong>{props.count}</strong><span>records available through existing backend APIs</span></div>
    </div>
  )
}

function Panel(props: { title: string; children: JSX.Element }) {
  return <section class="panel"><h2>{props.title}</h2>{props.children}</section>
}

function Metric(props: { label: string; value: number }) {
  return <div class="metric-card"><span>{props.label}</span><strong>{props.value}</strong></div>
}

function StatusPill(props: { status: string }) {
  return <span class={`status ${props.status.replaceAll("_", "-")}`}>{props.status}</span>
}

function TranscriptLoadingState() {
  return (
    <div class="session-empty-state loading">
      <span class="session-empty-orb" />
      <p class="eyebrow">Loading transcript</p>
      <h2>Pulling this session into view</h2>
      <p>Messages, todos, and file changes are loading from the sidecar.</p>
    </div>
  )
}

function SessionEmptyState() {
  return (
    <div class="session-empty-state">
      <OpencodeXLogo />
      <p>What should OpencodeX work on?</p>
    </div>
  )
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
