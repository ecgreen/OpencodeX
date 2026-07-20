import { Button } from "./ui"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { AttentionItem, WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, title } from "../lib/format"
import { projectSessions, type SessionOrderState } from "../lib/app-session-lists"
import { projectSwarms, projectViews } from "../lib/project-summary"
import { type GuiSnapshot } from "../lib/store"
import { StatusPill } from "./status-pill"
import { CardActionMenu } from "./card-action-menu"
import { ProjectCommandCenter } from "./project-command-center"
import { ProjectsOverview, projectLabel } from "./project-directory"

export function SessionCollectionPage(props: {
  sessions: Session[]
  projects: GuiSnapshot["projects"]
  sessionStatus: GuiSnapshot["sessionStatus"]
  openSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
}) {
  const projectBySessionID = createMemo(() => new Map(props.projects.flatMap((project) => project.sessionIDs.map((sessionID) => [sessionID, title(project.name ?? project.project.name)] as const))))
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <h1>Session workspace</h1>
      <p>Open, monitor, and resume existing TUI-compatible sessions from the shared backend data model.</p>
      <For each={props.sessions} fallback={<Empty text="No sessions" />}>
        {(session) => (
          <SessionCollectionRow
            session={session}
            project={projectBySessionID().get(session.id)}
            status={props.sessionStatus[session.id]?.type ?? "idle"}
            pinned={props.sessionPinned(session.id)}
            open={() => props.openSession(session.id)}
            togglePinned={() => props.toggleSessionPinned(session.id)}
            rename={() => props.renameSession(session)}
            move={() => props.moveSession(session)}
            remove={() => props.deleteSession(session)}
          />
        )}
      </For>
    </div>
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
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: (projectID: string) => void
  createProjectView: (projectID: string, sessionIDs: string[]) => void
  createProject: () => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
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
    const swarms = projects().reduce((count, project) => count + projectSwarms(project, props.snapshot).length, 0)
    const views = projects().reduce((count, project) => count + projectViews(project, props.snapshot, props.sessionOrderState).length, 0)
    return { attention, sessions, swarms, views }
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
          openView={props.openView}
          openSwarm={props.openSwarm}
          createSession={props.createSession}
          createSwarm={props.createSwarm}
          editProject={props.editProject}
          deleteProject={props.deleteProject}
          sessionPinned={props.sessionPinned}
          toggleSessionPinned={props.toggleSessionPinned}
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
