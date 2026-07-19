import type { JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { clientWorkItemBucket, type WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, tuiSidebarSessions, type SessionOrderState } from "../lib/app-session-lists"
import { deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/store"
import { projectSwarms, projectViewSessionCount, projectViews } from "../lib/project-summary"
import { CardActionMenu } from "./card-action-menu"
import { Button } from "./ui"
import { CardContextMenu } from "./card-context-menu"
import { DashboardSection, EmptyCreateDashboardCard } from "./dashboard-primitives"
import { SessionCardBucket, SessionStatusCard } from "./session-card-list"

export function Dashboard(props: {
  snapshot?: GuiSnapshot
  workItems: WorkItem[]
  sessionOrderState?: SessionOrderState
  logo: JSX.Element
  openProject: (projectID: string) => void
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
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, name: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot, props.sessionOrderState))
  const workBySessionID = createMemo(() => new Map(props.workItems.filter((item) => item.kind === "session" && item.sessionID).map((item) => [item.sessionID!, item])))
  const sessionBuckets = createMemo(() => new Map(sessions().map((session) => {
    const workItem = workBySessionID().get(session.id)
    return [session.id, workItem ? clientWorkItemBucket(workItem) : sessionOrderBucket(props.snapshot, session)] as const
  })))
  const bucketCount = (bucket: string) => Array.from(sessionBuckets().values()).filter((value) => value === bucket).length
  return (
    <div class="page dashboard-page">
      <header class="dashboard-overview">
        <div class="dashboard-overview-brand">
          <p>Workspace</p>
          {props.logo}
        </div>
        <dl class="dashboard-overview-metrics" aria-label="Session workload">
          <div class="status-input-needed"><dt>Needs input</dt><dd>{bucketCount("input_needed")}</dd></div>
          <div class="status-in-progress"><dt>Running</dt><dd>{bucketCount("in_progress")}</dd></div>
          <div class="status-ready-for-review"><dt>Ready to review</dt><dd>{bucketCount("ready_for_review")}</dd></div>
        </dl>
        <Button appearance="solid" tone="accent" icon="plus" onClick={() => props.createSession()}>
          New session
        </Button>
      </header>
      <section class="dashboard-sections">
        <DashboardSessionsSection sessions={sessions()} snapshot={props.snapshot} sessionBuckets={sessionBuckets()} openSession={props.openSession} createSession={() => props.createSession()} sessionPinned={props.sessionPinned} toggleSessionPinned={props.toggleSessionPinned} renameSession={props.renameSession} deleteSession={props.deleteSession} />
        <DashboardProjectsSection snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} openProject={props.openProject} createProject={props.createProject} createSession={props.createSession} editProject={props.editProject} deleteProject={props.deleteProject} />
        <DashboardSwarmsSection snapshot={props.snapshot} createSwarm={props.createSwarm} />
        <DashboardViewsSection snapshot={props.snapshot} openView={props.openView} createView={props.createView} viewPinned={props.viewPinned} toggleViewPinned={props.toggleViewPinned} editView={props.editView} deleteView={props.deleteView} />
      </section>
    </div>
  )
}

function DashboardProjectsSection(props: {
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  openProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  return (
    <DashboardSection title="Projects" count={props.snapshot?.projects.length ?? 0} action="New" onAction={props.createProject}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.projects ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create project" description="Group sessions, swarms, and views around a workspace." onClick={props.createProject} />}>
          {(project) => (
            <DashboardProjectCard
              project={project}
              snapshot={props.snapshot}
              sessionOrderState={props.sessionOrderState}
              openProject={() => props.openProject(project.id)}
              createSession={() => props.createSession(project.id, project.folders[0]?.path)}
              editProject={() =>
                props.editProject(
                  project.id,
                  title(project.name ?? project.project.name),
                  project.folders.map((folder) => folder.path),
                )
              }
              deleteProject={() => props.deleteProject(project.id, title(project.name ?? project.project.name))}
            />
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardProjectCard(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  openProject: () => void
  createSession: () => void
  editProject: () => void
  deleteProject: () => void
}) {
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot, props.sessionOrderState))
  const actions = () => [
    { label: "New session", icon: "plus", onSelect: props.createSession },
    { label: "Edit", icon: "pencil", onSelect: props.editProject },
    { label: "Delete", icon: "trash", danger: true, onSelect: props.deleteProject },
  ]
  return (
    <CardContextMenu actions={actions()}>
      {(openMenu) => (
        <article class="dashboard-item-card project-card interactive" onContextMenu={openMenu}>
          <Button appearance="ghost" class="dashboard-card-open dashboard-project-open" onClick={props.openProject}>
            <div>
              <strong>{title(props.project.name ?? props.project.project.name)}</strong>
              <span>{compactPath(props.project.folders[0]?.path ?? "")}</span>
            </div>
            <footer>
              <small>
                {sessions().length} sessions · {projectViews(props.project, props.snapshot).length} views · {projectSwarms(props.project, props.snapshot).length} swarms
              </small>
            </footer>
          </Button>
          <CardActionMenu label={title(props.project.name ?? props.project.project.name)} actions={actions()} />
        </article>
      )}
    </CardContextMenu>
  )
}

function DashboardSwarmsSection(props: { snapshot?: GuiSnapshot; createSwarm: () => void }) {
  return (
    <DashboardSection title="Swarms - Experimental" count={props.snapshot?.swarms.length ?? 0} action="New" onAction={props.createSwarm}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create swarm" description="Experimental durable agent-team automation." onClick={props.createSwarm} />}>
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

function DashboardSessionsSection(props: {
  sessions: Session[]
  snapshot?: GuiSnapshot
  sessionBuckets: Map<string, ReturnType<typeof clientWorkItemBucket> | ReturnType<typeof sessionOrderBucket>>
  openSession: (sessionID: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  createSession: () => void
}) {
  const [bucketCollapsed, setBucketCollapsed] = createSignal<Record<string, boolean>>({ inactive: true })
  const bucket = (session: Session) => props.sessionBuckets.get(session.id) ?? "inactive"
  const feedbackSessions = createMemo(() => props.sessions.filter((session) => bucket(session) === "input_needed"))
  const reviewSessions = createMemo(() => props.sessions.filter((session) => bucket(session) === "ready_for_review"))
  const progressSessions = createMemo(() => props.sessions.filter((session) => bucket(session) === "in_progress"))
  const inactiveSessions = createMemo(() => props.sessions.filter((session) => bucket(session) === "inactive"))
  const toggleBucket = (bucket: string) => setBucketCollapsed((value) => ({ ...value, [bucket]: !value[bucket] }))
  return (
    <DashboardSection title="Sessions" count={props.sessions.length}>
      <div class="dashboard-session-groups">
        <SessionCardBucket title="Needs Feedback" count={feedbackSessions().length} empty="No sessions need feedback." collapsed={bucketCollapsed().feedback} onToggle={() => toggleBucket("feedback")}>
          <For each={feedbackSessions()}>
            {(session) => (
              <SessionStatusCard
                session={session}
                snapshot={props.snapshot}
                openSession={props.openSession}
                pinned={props.sessionPinned(session.id)}
                togglePinned={() => props.toggleSessionPinned(session.id)}
                renameSession={() => props.renameSession(session)}
                deleteSession={() => props.deleteSession(session)}
              />
            )}
          </For>
        </SessionCardBucket>
        <SessionCardBucket title="Ready For Review" count={reviewSessions().length} empty="No completed sessions are waiting." collapsed={bucketCollapsed().review} onToggle={() => toggleBucket("review")}>
          <For each={reviewSessions()}>
            {(session) => (
              <SessionStatusCard
                session={session}
                snapshot={props.snapshot}
                openSession={props.openSession}
                pinned={props.sessionPinned(session.id)}
                togglePinned={() => props.toggleSessionPinned(session.id)}
                renameSession={() => props.renameSession(session)}
                deleteSession={() => props.deleteSession(session)}
              />
            )}
          </For>
        </SessionCardBucket>
        <SessionCardBucket title="In Progress" count={progressSessions().length} empty="No sessions are running." collapsed={bucketCollapsed().progress} onToggle={() => toggleBucket("progress")}>
          <For each={progressSessions()}>
            {(session) => (
              <SessionStatusCard
                session={session}
                snapshot={props.snapshot}
                openSession={props.openSession}
                pinned={props.sessionPinned(session.id)}
                togglePinned={() => props.toggleSessionPinned(session.id)}
                renameSession={() => props.renameSession(session)}
                deleteSession={() => props.deleteSession(session)}
              />
            )}
          </For>
        </SessionCardBucket>
        <SessionCardBucket title="Inactive Sessions" count={inactiveSessions().length} empty="No inactive sessions." collapsed={bucketCollapsed().inactive} onToggle={() => toggleBucket("inactive")}>
          <For each={inactiveSessions()}>
            {(session) => (
              <SessionStatusCard
                session={session}
                snapshot={props.snapshot}
                openSession={props.openSession}
                compact
                pinned={props.sessionPinned(session.id)}
                togglePinned={() => props.toggleSessionPinned(session.id)}
                renameSession={() => props.renameSession(session)}
                deleteSession={() => props.deleteSession(session)}
              />
            )}
          </For>
        </SessionCardBucket>
      </div>
    </DashboardSection>
  )
}

function DashboardViewsSection(props: {
  snapshot?: GuiSnapshot
  openView: (viewID: string) => void
  viewPinned: (viewID: string) => boolean
  toggleViewPinned: (viewID: string) => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, name: string) => void
  createView: () => void
}) {
  return (
    <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} action="New" onAction={props.createView}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.views ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create view" description="Build a focused multi-session view." onClick={props.createView} />}>
          {(view) => (
            <DashboardViewCard
              view={view}
              snapshot={props.snapshot}
              openView={props.openView}
              pinned={props.viewPinned(view.id)}
              togglePinned={() => props.toggleViewPinned(view.id)}
              editView={() => props.editView(view.id)}
              deleteView={() => props.deleteView(view.id, title(view.title))}
            />
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardViewCard(props: {
  view: GuiSnapshot["views"][number]
  snapshot?: GuiSnapshot
  openView: (viewID: string) => void
  pinned: boolean
  togglePinned: () => void
  editView: () => void
  deleteView: () => void
}) {
  const status = createMemo(() => viewDashboardStatus(props.view, props.snapshot))
  const actions = () => [
    { label: props.pinned ? "Unpin" : "Pin", icon: "pin", onSelect: props.togglePinned },
    { label: "Edit", icon: "pencil", onSelect: props.editView },
    { label: "Delete", icon: "trash", danger: true, onSelect: props.deleteView },
  ]
  return (
    <CardContextMenu actions={actions()}>
      {(openMenu) => (
        <article
          class="dashboard-item-card dashboard-status-card interactive"
          classList={{ [`status-${status().replaceAll("_", "-")}`]: true }}
          onContextMenu={openMenu}
        >
          <Button appearance="ghost" class="dashboard-card-open" onClick={() => props.openView(props.view.id)}>
            <div>
              <strong>{title(props.view.title)}</strong>
            </div>
            <footer>
              <span class="card-status-label">{sessionStatusLabel(status())}</span>
              <small>{viewDashboardMeta(props.view)}</small>
            </footer>
          </Button>
          <CardActionMenu label={title(props.view.title)} actions={actions()} />
          <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
          <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sessionStatusLabel(status())} /></Show>
        </article>
      )}
    </CardContextMenu>
  )
}

function viewDashboardStatus(view: GuiSnapshot["views"][number], snapshot?: GuiSnapshot): DerivedSessionStatus {
  return deriveViewStatus(view, snapshot)
}

function viewDashboardMeta(view: GuiSnapshot["views"][number]) {
  return `${formatRelative(view.timeUpdated)} - ${projectViewSessionCount(view)} sessions`
}
