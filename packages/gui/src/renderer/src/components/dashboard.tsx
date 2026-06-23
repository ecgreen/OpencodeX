import type { JSX } from "solid-js"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, tuiSidebarSessions } from "../lib/app-session-lists"
import { deriveSessionStatus, deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/store"
import { pendingViewSessions } from "../lib/view-items"
import { Icon } from "./icon"
import { PinButton } from "./pin-button"
import { Button, IconButton } from "./ui"
import { DashboardActionCard, DashboardSection, Empty, EmptyCreateDashboardCard } from "./dashboard-primitives"

const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000

export function Dashboard(props: {
  snapshot?: GuiSnapshot
  logo: JSX.Element
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  sessionPinned: (sessionID: string) => boolean
  viewPinned: (viewID: string) => boolean
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: () => void
  createView: () => void
  toggleSessionPinned: (sessionID: string) => void
  toggleViewPinned: (viewID: string) => void
  renameProject: (projectID: string, current?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({ swarms: true, prior: true })
  const [selectedProjectID, setSelectedProjectID] = createSignal("")
  const selectedProject = createMemo(() => (props.snapshot?.projects ?? []).find((project) => project.id === selectedProjectID()))
  const toggleSection = (section: string) => setCollapsed((value) => ({ ...value, [section]: !value[section] }))
  return (
    <div class="page dashboard-page">
      {props.logo}
      <DashboardActions
        snapshot={props.snapshot}
        sessionCount={sessions().length}
        createProject={props.createProject}
        createSession={() => props.createSession()}
        createSwarm={props.createSwarm}
        createView={props.createView}
      />
      <section class="dashboard-sections">
        <Show when={selectedProject()}>
          {(project) => (
            <DashboardProjectView
              project={project()}
              snapshot={props.snapshot}
              openSession={props.openSession}
              openView={props.openView}
              createSession={props.createSession}
              editProjectFolders={props.editProjectFolders}
              close={() => setSelectedProjectID("")}
            />
          )}
        </Show>
        <DashboardProjectsSection snapshot={props.snapshot} collapsed={!!collapsed().projects} onToggle={() => toggleSection("projects")} openProject={setSelectedProjectID} createProject={props.createProject} createSession={props.createSession} renameProject={props.renameProject} editProjectFolders={props.editProjectFolders} deleteProject={props.deleteProject} />
        <DashboardSwarmsSection snapshot={props.snapshot} collapsed={!!collapsed().swarms} onToggle={() => toggleSection("swarms")} createSwarm={props.createSwarm} />
        <DashboardAttentionSection snapshot={props.snapshot} collapsed={!!collapsed().attention} onToggle={() => toggleSection("attention")} openSession={props.openSession} />
        <DashboardSessionsSection title="Recent Sessions" sessions={sessions()} snapshot={props.snapshot} collapsed={!!collapsed().sessions} onToggle={() => toggleSection("sessions")} openSession={props.openSession} createSession={() => props.createSession()} sessionPinned={props.sessionPinned} toggleSessionPinned={props.toggleSessionPinned} />
        <DashboardViewsSection snapshot={props.snapshot} collapsed={!!collapsed().views} onToggle={() => toggleSection("views")} openView={props.openView} createView={props.createView} viewPinned={props.viewPinned} toggleViewPinned={props.toggleViewPinned} />
        <DashboardSessionsSection title="Prior Sessions" sessions={sessions()} snapshot={props.snapshot} collapsed={!!collapsed().prior} onToggle={() => toggleSection("prior")} openSession={props.openSession} compact sessionPinned={props.sessionPinned} toggleSessionPinned={props.toggleSessionPinned} />
      </section>
    </div>
  )
}

function DashboardActions(props: {
  snapshot?: GuiSnapshot
  sessionCount: number
  createProject: () => void
  createSession: () => void
  createSwarm: () => void
  createView: () => void
}) {
  return (
    <section class="dashboard-actions" aria-label="Create new OpencodeX items">
      <DashboardActionCard title="Project" description="Create project" meta={`${props.snapshot?.projects.length ?? 0}`} tone="project" icon="folder" onClick={props.createProject} />
      <DashboardActionCard title="Session" description="Start chat" meta={`${props.sessionCount}`} tone="session" icon="session" onClick={props.createSession} />
      <DashboardActionCard title="Swarm" description="Agent team" meta={`${props.snapshot?.swarms.length ?? 0}`} tone="swarm" icon="swarm" onClick={props.createSwarm} />
      <DashboardActionCard title="View" description="Multi-session" meta={`${props.snapshot?.views.length ?? 0}`} tone="view" icon="views" onClick={props.createView} />
    </section>
  )
}

function DashboardProjectsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  onToggle: () => void
  openProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  renameProject: (projectID: string, current?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  return (
    <DashboardSection title="Projects" count={props.snapshot?.projects.length ?? 0} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.projects ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create project" description="Group sessions, swarms, and views around a workspace." onClick={props.createProject} />}>
          {(project) => (
            <article class="dashboard-item-card project-card">
              <button class="dashboard-project-open" onClick={() => props.openProject(project.id)}>
                <strong>{title(project.name ?? project.project.name)}</strong>
                <span>{projectSessions(project, props.snapshot).length} sessions - {projectSwarms(project, props.snapshot).length} swarms - {projectViews(project, props.snapshot).length} views</span>
                <small class="project-folder-label" title={project.folders[0]?.path}>{compactPath(project.folders[0]?.path)}</small>
              </button>
              <div class="row-actions">
                <Button size="sm" icon="session" onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</Button>
                <IconButton icon="pencil" label={`Rename ${title(project.name ?? project.project.name)}`} onClick={() => props.renameProject(project.id, project.name ?? project.project.name)} />
                <IconButton icon="folder" label={`Edit folders for ${title(project.name ?? project.project.name)}`} onClick={() => props.editProjectFolders(project.id, project.folders.map((folder) => folder.path))} />
                <IconButton class="danger" variant="danger" icon="trash" label={`Delete ${title(project.name ?? project.project.name)}`} onClick={() => props.deleteProject(project.id, title(project.name ?? project.project.name))} />
              </div>
            </article>
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardProjectView(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  close: () => void
}) {
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot))
  const recent = createMemo(() => sessions().filter((session) => isRecentSessionUpdate(session.time.updated)).slice(0, 5))
  const past = createMemo(() => sessions().filter((session) => !isRecentSessionUpdate(session.time.updated)).slice(0, 6))
  const attention = createMemo(() => projectAttentionItems(props.project, props.snapshot).slice(0, 5))
  const views = createMemo(() => projectViews(props.project, props.snapshot).slice(0, 5))
  return (
    <section class="dashboard-project-view">
      <header>
        <div>
          <button class="secondary" onClick={props.close}><Icon name="chevronLeft" /> Projects</button>
          <h2>{title(props.project.name ?? props.project.project.name)}</h2>
          <p>{sessions().length} sessions - {views().length} views - {props.project.folders.length} folders</p>
        </div>
        <div class="row-actions">
          <Button size="sm" icon="session" onClick={() => props.createSession(props.project.id, props.project.folders[0]?.path)}>Session</Button>
          <IconButton icon="folder" label={`Edit folders for ${title(props.project.name ?? props.project.project.name)}`} onClick={() => props.editProjectFolders(props.project.id, props.project.folders.map((folder) => folder.path))} />
        </div>
      </header>
      <div class="dashboard-project-view-grid">
        <ProjectDetailList title="Attention" count={attention().length} empty="Nothing needs attention.">
          <For each={attention()}>
            {(item) => (
              <button class="project-detail-row warning" onClick={() => props.openSession(item.sessionID)}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </button>
            )}
          </For>
        </ProjectDetailList>
        <ProjectDetailList title="Recent Sessions" count={recent().length} empty="No recent sessions.">
          <For each={recent()}>
            {(session) => (
              <button class="project-detail-row" onClick={() => props.openSession(session.id)}>
                <strong>{title(session.title)}</strong>
                <span>{formatRelative(session.time.updated)}</span>
              </button>
            )}
          </For>
        </ProjectDetailList>
        <ProjectDetailList title="Views" count={views().length} empty="No views include this project yet.">
          <For each={views()}>
            {(view) => (
              <button class="project-detail-row" onClick={() => props.openView(view.id)}>
                <strong>{title(view.title)}</strong>
                <span>{viewDashboardMeta(view)}</span>
              </button>
            )}
          </For>
        </ProjectDetailList>
        <ProjectDetailList title="Past Sessions" count={past().length} empty="No past sessions.">
          <For each={past()}>
            {(session) => (
              <button class="project-detail-row" onClick={() => props.openSession(session.id)}>
                <strong>{title(session.title)}</strong>
                <span>{formatRelative(session.time.updated)}</span>
              </button>
            )}
          </For>
        </ProjectDetailList>
        <ProjectDetailList title="Folders" count={props.project.folders.length} empty="No folders assigned.">
          <For each={props.project.folders}>
            {(folder) => (
              <div class="project-detail-row">
                <strong>{compactPath(folder.path)}</strong>
                <span>{folder.path}</span>
              </div>
            )}
          </For>
        </ProjectDetailList>
      </div>
    </section>
  )
}

function ProjectDetailList(props: { title: string; count: number; empty: string; children: JSX.Element }) {
  return (
    <section class="project-detail-list">
      <header>
        <strong>{props.title}</strong>
        <small>{props.count}</small>
      </header>
      <div>
        <Show when={props.count > 0} fallback={<div class="empty">{props.empty}</div>}>
          {props.children}
        </Show>
      </div>
    </section>
  )
}

function DashboardSwarmsSection(props: { snapshot?: GuiSnapshot; collapsed: boolean; onToggle: () => void; createSwarm: () => void }) {
  return (
    <DashboardSection title="Swarms" count={props.snapshot?.swarms.length ?? 0} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create swarm" description="Build an Agent team." onClick={props.createSwarm} />}>
          {(swarm) => (
            <article class="dashboard-item-card">
              <div>
                <strong>{title(swarm.title)}</strong>
                <span>{swarm.roles.length} roles - {swarm.runs.length} runs</span>
              </div>
              <footer>
                <small>{formatRelative(swarm.timeUpdated)}</small>
              </footer>
            </article>
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardAttentionSection(props: { snapshot?: GuiSnapshot; collapsed: boolean; onToggle: () => void; openSession: (sessionID: string) => void }) {
  const attentionJobs = createMemo(() => (props.snapshot?.jobs ?? []).filter((job) => ["input_needed", "approval_needed", "blocked", "failed"].includes(job.status)).slice(0, 8))
  const attentionCount = createMemo(() => (props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0) + attentionJobs().length)
  return (
    <DashboardSection title="Attention Needed" count={attentionCount()} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class="dashboard-card-grid">
        <For each={props.snapshot?.permissions ?? []}>
          {(request) => (
            <button class="dashboard-item-card warning interactive" onClick={() => props.openSession(request.sessionID)}>
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
            <button class="dashboard-item-card warning interactive" onClick={() => props.openSession(request.sessionID)}>
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
  )
}

function DashboardSessionsSection(props: {
  title: "Recent Sessions" | "Prior Sessions"
  sessions: Session[]
  snapshot?: GuiSnapshot
  collapsed: boolean
  onToggle: () => void
  openSession: (sessionID: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  createSession?: () => void
  compact?: boolean
}) {
  const sessions = createMemo(() => props.sessions.filter((session) => props.compact ? !isRecentSessionUpdate(session.time.updated) : isRecentSessionUpdate(session.time.updated)))
  return (
    <DashboardSection title={props.title} count={sessions().length} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class={`dashboard-card-grid${props.compact ? " compact" : ""}`}>
        <For each={sessions()} fallback={props.compact ? <Empty text="No prior sessions." /> : <EmptyCreateDashboardCard title="Create session" description="Start a new chat from the dashboard." onClick={() => props.createSession?.()} />}>
          {(session) => (
            <DashboardSessionCard
              session={session}
              snapshot={props.snapshot}
              openSession={props.openSession}
              compact={props.compact}
              pinned={props.sessionPinned(session.id)}
              togglePinned={() => props.toggleSessionPinned(session.id)}
            />
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardViewsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  onToggle: () => void
  openView: (viewID: string) => void
  viewPinned: (viewID: string) => boolean
  toggleViewPinned: (viewID: string) => void
  createView: () => void
}) {
  return (
    <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.views ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create view" description="Build a focused multi-session view." onClick={props.createView} />}>
          {(view) => (
            <DashboardViewCard
              view={view}
              snapshot={props.snapshot}
              openView={props.openView}
              pinned={props.viewPinned(view.id)}
              togglePinned={() => props.toggleViewPinned(view.id)}
            />
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardSessionCard(props: {
  session: Session
  snapshot?: GuiSnapshot
  openSession: (sessionID: string) => void
  pinned: boolean
  togglePinned: () => void
  compact?: boolean
}) {
  const status = createMemo(() => sidebarStatus(props.snapshot, props.session))
  return (
    <article
      class="dashboard-item-card dashboard-status-card interactive"
      classList={{ compact: props.compact === true, [`status-${status().replaceAll("_", "-")}`]: true }}
    >
      <button class="dashboard-card-open" onClick={() => props.openSession(props.session.id)}>
        <div>
          <strong>{title(props.session.title)}</strong>
        </div>
        <footer>
          <small>{dashboardSessionMeta(props.session, props.snapshot)}</small>
        </footer>
      </button>
      <PinButton pinned={props.pinned} label={title(props.session.title)} onClick={props.togglePinned} />
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
    </article>
  )
}

function DashboardViewCard(props: {
  view: GuiSnapshot["views"][number]
  snapshot?: GuiSnapshot
  openView: (viewID: string) => void
  pinned: boolean
  togglePinned: () => void
}) {
  const status = createMemo(() => viewDashboardStatus(props.view, props.snapshot))
  return (
    <article
      class="dashboard-item-card dashboard-status-card interactive"
      classList={{ [`status-${status().replaceAll("_", "-")}`]: true }}
    >
      <button class="dashboard-card-open" onClick={() => props.openView(props.view.id)}>
        <div>
          <strong>{title(props.view.title)}</strong>
        </div>
        <footer>
          <small>{viewDashboardMeta(props.view)}</small>
        </footer>
      </button>
      <PinButton pinned={props.pinned} label={title(props.view.title)} onClick={props.togglePinned} />
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
    </article>
  )
}

function projectSwarms(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  return (snapshot?.swarms ?? []).filter((swarm) => swarm.projectID === project.id)
}

function projectViews(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  const sessionIDs = new Set(projectSessions(project, snapshot).map((session) => session.id))
  return (snapshot?.views ?? [])
    .filter((view) => view.sessionIDs.some((sessionID) => sessionIDs.has(sessionID)) || pendingViewSessions(view).some((item) => item.projectID === project.id))
    .toSorted((a, b) => new Date(b.timeUpdated).getTime() - new Date(a.timeUpdated).getTime())
}

function projectAttentionItems(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  const sessionIDs = new Set(projectSessions(project, snapshot).map((session) => session.id))
  const permissions = (snapshot?.permissions ?? [])
    .filter((request) => sessionIDs.has(request.sessionID))
    .map((request) => ({ sessionID: request.sessionID, title: "Permission required", detail: request.permission }))
  const questions = (snapshot?.questions ?? [])
    .filter((request) => sessionIDs.has(request.sessionID))
    .map((request) => ({ sessionID: request.sessionID, title: "Question pending", detail: request.questions[0]?.question ?? "Agent needs input" }))
  const jobs = (snapshot?.jobs ?? [])
    .filter((job) => job.sessionID && sessionIDs.has(job.sessionID) && ["input_needed", "approval_needed", "blocked", "failed"].includes(job.status))
    .map((job) => ({ sessionID: job.sessionID!, title: title(job.title ?? job.kind), detail: job.status }))
  return [...permissions, ...questions, ...jobs]
}

function sessionProjectName(session: Session, snapshot?: GuiSnapshot) {
  const project = (snapshot?.projects ?? []).find((item) => item.sessions.some((projectSession) => projectSession.id === session.id))
  if (!project) return
  return title(project.name ?? project.project.name)
}

function dashboardSessionMeta(session: Session, snapshot?: GuiSnapshot) {
  const project = sessionProjectName(session, snapshot)
  return [formatRelative(session.time.updated), project].filter(Boolean).join(" - ")
}

function viewSessionCount(view: OpencodeXView) {
  return view.sessionIDs.length + pendingViewSessions(view).length
}

function viewDashboardStatus(view: GuiSnapshot["views"][number], snapshot?: GuiSnapshot): DerivedSessionStatus {
  return deriveViewStatus(view, snapshot)
}

function viewDashboardMeta(view: OpencodeXView) {
  return `${formatRelative(view.timeUpdated)} - ${viewSessionCount(view)} sessions`
}

function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

function sidebarStatus(snapshot: GuiSnapshot | undefined, session: Session): DerivedSessionStatus {
  return deriveSessionStatus(snapshot, session)
}
