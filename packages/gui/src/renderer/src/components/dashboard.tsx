import type { JSX } from "solid-js"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { deriveSessionStatus, deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { isRenderableSession, type GuiSnapshot } from "../lib/store"
import { pendingViewSessions } from "../lib/view-items"
import { Icon } from "./icon"

const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000

export function Dashboard(props: {
  snapshot?: GuiSnapshot
  logo: JSX.Element
  openSession: (sessionID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: () => void
  createView: () => void
  renameProject: (projectID: string, current?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({ swarms: true, prior: true })
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
        <DashboardProjectsSection snapshot={props.snapshot} collapsed={!!collapsed().projects} onToggle={() => toggleSection("projects")} createProject={props.createProject} createSession={props.createSession} renameProject={props.renameProject} editProjectFolders={props.editProjectFolders} deleteProject={props.deleteProject} />
        <DashboardSwarmsSection snapshot={props.snapshot} collapsed={!!collapsed().swarms} onToggle={() => toggleSection("swarms")} createSwarm={props.createSwarm} />
        <DashboardAttentionSection snapshot={props.snapshot} collapsed={!!collapsed().attention} onToggle={() => toggleSection("attention")} openSession={props.openSession} />
        <DashboardSessionsSection title="Recent Sessions" sessions={sessions()} snapshot={props.snapshot} collapsed={!!collapsed().sessions} onToggle={() => toggleSection("sessions")} openSession={props.openSession} createSession={() => props.createSession()} />
        <DashboardViewsSection snapshot={props.snapshot} collapsed={!!collapsed().views} onToggle={() => toggleSection("views")} createView={props.createView} />
        <DashboardSessionsSection title="Prior Sessions" sessions={sessions()} snapshot={props.snapshot} collapsed={!!collapsed().prior} onToggle={() => toggleSection("prior")} openSession={props.openSession} compact />
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
      <DashboardActionCard title="Project" description="Group work" meta={`${props.snapshot?.projects.length ?? 0} projects`} tone="primary" onClick={props.createProject} />
      <DashboardActionCard title="Session" description="New chat" meta={`${props.sessionCount} sessions`} tone="blue" onClick={props.createSession} />
      <DashboardActionCard title="Swarm" description="Agent team" meta={`${props.snapshot?.swarms.length ?? 0} swarms`} tone="warning" onClick={props.createSwarm} />
      <DashboardActionCard title="View" description="Multi-session" meta={`${props.snapshot?.views.length ?? 0} views`} tone="info" onClick={props.createView} />
    </section>
  )
}

function DashboardProjectsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  onToggle: () => void
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
              <div>
                <strong>{title(project.name ?? project.project.name)}</strong>
                <span>{projectSessions(project, props.snapshot).length} sessions - {projectSwarms(project, props.snapshot).length} swarms</span>
                <small class="project-folder-label" title={project.folders[0]?.path}>{compactPath(project.folders[0]?.path)}</small>
              </div>
              <div class="row-actions">
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
  createSession?: () => void
  compact?: boolean
}) {
  const sessions = createMemo(() => props.sessions.filter((session) => props.compact ? !isRecentSessionUpdate(session.time.updated) : isRecentSessionUpdate(session.time.updated)))
  return (
    <DashboardSection title={props.title} count={sessions().length} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class={`dashboard-card-grid${props.compact ? " compact" : ""}`}>
        <For each={sessions()} fallback={props.compact ? <Empty text="No prior sessions." /> : <EmptyCreateDashboardCard title="Create session" description="Start a new chat from the dashboard." onClick={() => props.createSession?.()} />}>
          {(session) => (
            <DashboardSessionCard session={session} snapshot={props.snapshot} openSession={props.openSession} compact={props.compact} />
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardViewsSection(props: { snapshot?: GuiSnapshot; collapsed: boolean; onToggle: () => void; createView: () => void }) {
  return (
    <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} collapsed={props.collapsed} onToggle={props.onToggle}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.views ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create view" description="Build a focused multi-session view." onClick={props.createView} />}>
          {(view) => <DashboardViewCard view={view} snapshot={props.snapshot} />}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardSessionCard(props: { session: Session; snapshot?: GuiSnapshot; openSession: (sessionID: string) => void; compact?: boolean }) {
  const status = createMemo(() => sidebarStatus(props.snapshot, props.session))
  return (
    <button
      class="dashboard-item-card dashboard-status-card interactive"
      classList={{ compact: props.compact === true, [`status-${status().replaceAll("_", "-")}`]: true }}
      onClick={() => props.openSession(props.session.id)}
    >
      <div>
        <strong>{title(props.session.title)}</strong>
      </div>
      <footer>
        <small>{dashboardSessionMeta(props.session, props.snapshot)}</small>
      </footer>
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
    </button>
  )
}

function DashboardViewCard(props: { view: GuiSnapshot["views"][number]; snapshot?: GuiSnapshot }) {
  const status = createMemo(() => viewDashboardStatus(props.view, props.snapshot))
  return (
    <article class="dashboard-item-card dashboard-status-card" classList={{ [`status-${status().replaceAll("_", "-")}`]: true }}>
      <div>
        <strong>{title(props.view.title)}</strong>
        <span>{viewSessionCount(props.view)} sessions</span>
      </div>
      <footer>
        <small>{formatRelative(props.view.timeUpdated)}</small>
      </footer>
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
    </article>
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
          <button class="section-collapse" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>
            <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
            <strong>{props.title} <span class="section-count">({props.count})</span></strong>
          </button>
        </div>
        <Show when={props.action && props.onAction}>
          <button class="secondary" onClick={props.onAction}>{props.action}</button>
        </Show>
      </header>
      <div class="dashboard-section-content" classList={{ collapsed: props.collapsed }}>
        <div>{props.children}</div>
      </div>
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

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}

function isTUISidebarSession(session: Session) {
  return !session.parentID && !isSwarmSession(session) && isRenderableSession(session)
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
    .filter(isTUISidebarSession)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

function projectSwarms(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  return (snapshot?.swarms ?? []).filter((swarm) => swarm.projectID === project.id)
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

function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

function sidebarStatus(snapshot: GuiSnapshot | undefined, session: Session): DerivedSessionStatus {
  return deriveSessionStatus(snapshot, session)
}
