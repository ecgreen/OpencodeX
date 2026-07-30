import { Button, StatusBadge } from "./ui"
import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import type { AttentionItem, WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, title } from "../lib/format"
import { projectSessions, type SessionOrderState } from "../lib/app-session-lists"
import { projectSessionStatus } from "../lib/project-summary"
import { type GuiSnapshot } from "../lib/session-api"
import { StatusPill } from "./status-pill"
import { CardActionMenu } from "./card-action-menu"
import { ProjectCommandCenter } from "./project-command-center"
import { ProjectsOverview, projectLabel } from "./project-directory"

export function SessionCollectionPage(props: {
  sessions: Session[]
  terminalSessions: OpencodeXTerminalSession[]
  projects: GuiSnapshot["projects"]
  sessionStatus: GuiSnapshot["sessionStatus"]
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  renameTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  moveTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  removeTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  terminalStatus: (terminalSession: OpencodeXTerminalSession) => string
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  createSession: () => void
}) {
  const projectBySessionID = createMemo(() => new Map(props.projects.flatMap((project) => [
    ...project.sessionIDs,
    ...project.terminalSessions.map((session) => session.id),
  ].map((sessionID) => [sessionID, title(project.name ?? project.project.name)] as const))))
  const sessions = createMemo(() => [
    ...props.sessions.map((session) => ({ kind: "session" as const, session, updated: session.time.updated })),
    ...props.terminalSessions.map((terminalSession) => ({
      kind: "terminal" as const,
      terminalSession,
      updated: Number(terminalSession.timeUpdated),
    })),
  ].sort((a, b) => b.updated - a.updated))
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <div class="collection-page-heading">
        <div>
          <h1>Session workspace</h1>
          <p>Open OpenCode conversations and durable Claude Code terminal sessions.</p>
        </div>
        <div class="row-actions">
          <Button appearance="solid" tone="accent" icon="plus" onClick={props.createSession}>New session</Button>
        </div>
      </div>
      <For each={sessions()} fallback={<Empty text="No sessions" />}>
        {(item) => item.kind === "session" ? (
            <SessionCollectionRow
              session={item.session}
              project={projectBySessionID().get(item.session.id)}
              status={props.sessionStatus[item.session.id]?.type ?? "idle"}
              pinned={props.sessionPinned(item.session.id)}
              open={() => props.openSession(item.session.id)}
              togglePinned={() => props.toggleSessionPinned(item.session.id)}
              rename={() => props.renameSession(item.session)}
              move={() => props.moveSession(item.session)}
              remove={() => props.deleteSession(item.session)}
            />
          ) : (
            <TerminalSessionCollectionRow
              terminalSession={item.terminalSession}
              project={projectBySessionID().get(item.terminalSession.id)}
              status={props.terminalStatus(item.terminalSession)}
              pinned={props.sessionPinned(item.terminalSession.id)}
              open={() => props.openTerminalSession(item.terminalSession.id)}
              togglePinned={() => props.toggleSessionPinned(item.terminalSession.id)}
              rename={() => props.renameTerminalSession(item.terminalSession)}
              move={() => props.moveTerminalSession(item.terminalSession)}
              remove={() => props.removeTerminalSession(item.terminalSession)}
            />
          )}
      </For>
    </div>
  )
}

function TerminalSessionCollectionRow(props: {
  terminalSession: OpencodeXTerminalSession
  project?: string
  status: string
  pinned: boolean
  open: () => void
  togglePinned: () => void
  rename: () => void
  move: () => void
  remove: () => void
}) {
  const name = () => title(props.terminalSession.title)
  const actions = () => [
    { label: props.pinned ? "Unpin session" : "Pin session", icon: "pin" as const, onSelect: props.togglePinned },
    { label: "Rename", icon: "pencil" as const, onSelect: props.rename },
    { label: "Move to project", icon: "folder" as const, onSelect: props.move },
    { label: "Remove from OpencodeX", icon: "trash" as const, danger: true, onSelect: props.remove },
  ]
  return (
    <article class="card-row session-collection-row">
      <Button appearance="ghost" type="button" class="session-collection-open" onClick={props.open}>
        <span>
          <span class="session-collection-title"><strong>{name()}</strong><StatusBadge status="info">Claude Code</StatusBadge></span>
          <small>{[props.project, compactPath(props.terminalSession.directory)].filter(Boolean).join(" - ")}</small>
        </span>
        <StatusBadge status={props.status}>{props.status}</StatusBadge>
      </Button>
      <CardActionMenu label={name()} actions={actions()} />
    </article>
  )
}

function SessionCollectionRow(props: {
  session: Session
  project?: string
  status: string
  pinned: boolean
  open: () => void
  togglePinned: () => void
  rename: () => void
  move: () => void
  remove: () => void
}) {
  const name = () => title(props.session.title)
  const actions = () => [
    { label: props.pinned ? "Unpin session" : "Pin session", icon: "pin" as const, onSelect: props.togglePinned },
    { label: "Rename session", icon: "pencil" as const, onSelect: props.rename },
    { label: "Move to project", icon: "folder" as const, onSelect: props.move },
    { label: "Delete session", icon: "trash" as const, danger: true, onSelect: props.remove },
  ]
  return (
    <article class="card-row session-collection-row">
      <Button appearance="ghost" type="button" class="session-collection-open" onClick={props.open}>
        <span>
          <strong>{name()}</strong>
          <small>{[props.project, compactPath(props.session.directory)].filter(Boolean).join(" - ")}</small>
        </span>
        <StatusPill status={props.status} />
      </Button>
      <CardActionMenu label={name()} actions={actions()} />
    </article>
  )
}

export function ProjectCollectionPage(props: {
  snapshot?: GuiSnapshot
  workItems: WorkItem[]
  attentionItems: AttentionItem[]
  sessionOrderState?: SessionOrderState
  projectID?: string
  openProject: (projectID: string) => void
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  createProjectView: (projectID: string, sessionIDs: string[]) => void
  createProject: () => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  terminalStatus: (terminalSessionID: string) => string
}) {
  const [query, setQuery] = createSignal("")
  const projects = createMemo(() => props.snapshot?.projects ?? [])
  const activeProject = createMemo(() => props.projectID ? projects().find((project) => project.id === props.projectID) : undefined)
  const filteredProjects = createMemo(() => {
    const text = query().trim().toLowerCase()
    if (!text) return projects()
    return projects().filter((project) =>
      projectLabel(project).toLowerCase().includes(text)
      || project.folders.some((folder) => folder.path.toLowerCase().includes(text)),
    )
  })
  const overview = createMemo(() => {
    const attention = props.attentionItems.filter((item) => item.projectID && projects().some((project) => project.id === item.projectID)).length
    const sessions = projects().reduce((count, project) => count + projectSessions(project, props.snapshot, props.sessionOrderState).length, 0)
    const terminalSessions = projects().reduce((count, project) => count + project.terminalSessions.length, 0)
    const running = projects().filter((project) => projectSessionStatus(project, props.snapshot, props.sessionOrderState) === "in_progress").length
    return { attention, running, sessions, terminalSessions }
  })

  return (
    <Show when={activeProject()} fallback={(
      <ProjectsOverview
        projects={projects()}
        filteredProjects={filteredProjects()}
        query={query()}
        setQuery={setQuery}
        snapshot={props.snapshot}
        sessionOrderState={props.sessionOrderState}
        overview={overview()}
        openProject={props.openProject}
        createProject={props.createProject}
        createSession={props.createSession}
        editProject={props.editProject}
        deleteProject={props.deleteProject}
        moveProject={props.moveProject}
        reorderProject={props.reorderProject}
      />
    )}>
      {(project) => (
        <ProjectCommandCenter
          project={project()}
          snapshot={props.snapshot}
          workItems={props.workItems}
          attentionItems={props.attentionItems}
          sessionOrderState={props.sessionOrderState}
          back={() => props.openProject("")}
          openSession={props.openSession}
          openTerminalSession={props.openTerminalSession}
          openView={props.openView}
          openSwarm={props.openSwarm}
          createSession={props.createSession}
          editProject={props.editProject}
          deleteProject={props.deleteProject}
          sessionPinned={props.sessionPinned}
          toggleSessionPinned={props.toggleSessionPinned}
          terminalStatus={props.terminalStatus}
        />
      )}
    </Show>
  )
}

export function StatusPage(props: { snapshot?: GuiSnapshot }) {
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

export function CollectionPage(props: { title: string; count: number; description: string }) {
  return (
    <div class="page placeholder-page">
      <p class="eyebrow">Parity area</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      <div class="metric-card large"><strong>{props.count}</strong><span>records available through existing backend APIs</span></div>
    </div>
  )
}

function Metric(props: { label: string; value: number }) {
  return <div class="metric-card"><span>{props.label}</span><strong>{props.value}</strong></div>
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
