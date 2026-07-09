import type { JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, tuiSidebarSessions, type SessionOrderState } from "../lib/app-session-lists"
import { deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/store"
import { projectSwarms, projectViewSessionCount, projectViews } from "../lib/project-summary"
import { PinButton } from "./pin-button"
import { Button, IconButton } from "./ui"
import { CardContextMenu } from "./card-context-menu"
import { DashboardSection, EmptyCreateDashboardCard } from "./dashboard-primitives"
import { SessionCardBucket, SessionStatusCard } from "./session-card-list"

export function Dashboard(props: {
  snapshot?: GuiSnapshot
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
  return (
    <div class="page dashboard-page">
      {props.logo}
      <section class="dashboard-sections">
        <DashboardSessionsSection sessions={sessions()} snapshot={props.snapshot} openSession={props.openSession} createSession={() => props.createSession()} sessionPinned={props.sessionPinned} toggleSessionPinned={props.toggleSessionPinned} renameSession={props.renameSession} deleteSession={props.deleteSession} />
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
            <article class="dashboard-item-card project-card">
              <button class="dashboard-project-open" onClick={() => props.openProject(project.id)}>
                <strong>{title(project.name ?? project.project.name)}</strong>
                <span>{projectSessions(project, props.snapshot, props.sessionOrderState).length} sessions - {projectSwarms(project, props.snapshot).length} swarms - {projectViews(project, props.snapshot, props.sessionOrderState).length} views</span>
                <small class="project-folder-label" title={project.folders[0]?.path}>{compactPath(project.folders[0]?.path)}</small>
              </button>
              <div class="row-actions">
                <Button size="sm" icon="session" onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</Button>
                <IconButton icon="pencil" label={`Edit ${title(project.name ?? project.project.name)}`} onClick={() => props.editProject(project.id, title(project.name ?? project.project.name), project.folders.map((folder) => folder.path))} />
                <IconButton class="danger" variant="danger" icon="trash" label={`Delete ${title(project.name ?? project.project.name)}`} onClick={() => props.deleteProject(project.id, title(project.name ?? project.project.name))} />
              </div>
            </article>
          )}
        </For>
      </div>
    </DashboardSection>
  )
}

function DashboardSwarmsSection(props: { snapshot?: GuiSnapshot; createSwarm: () => void }) {
  return (
    <DashboardSection title="Swarms" count={props.snapshot?.swarms.length ?? 0} action="New" onAction={props.createSwarm}>
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

function DashboardSessionsSection(props: {
  sessions: Session[]
  snapshot?: GuiSnapshot
  openSession: (sessionID: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  createSession: () => void
}) {
  const [bucketCollapsed, setBucketCollapsed] = createSignal<Record<string, boolean>>({ inactive: true })
  const feedbackSessions = createMemo(() => props.sessions.filter((session) => sessionOrderBucket(props.snapshot, session) === "input_needed"))
  const reviewSessions = createMemo(() => props.sessions.filter((session) => sessionOrderBucket(props.snapshot, session) === "ready_for_review"))
  const progressSessions = createMemo(() => props.sessions.filter((session) => sessionOrderBucket(props.snapshot, session) === "in_progress"))
  const inactiveSessions = createMemo(() => props.sessions.filter((session) => sessionOrderBucket(props.snapshot, session) === "inactive"))
  const toggleBucket = (bucket: string) => setBucketCollapsed((value) => ({ ...value, [bucket]: !value[bucket] }))
  return (
    <DashboardSection title="Sessions" count={props.sessions.length} action="New" onAction={props.createSession}>
      <div class="dashboard-session-groups">
        <SessionCardBucket title="Needs Feedback" count={feedbackSessions().length} empty="No sessions need feedback." collapsed={!!bucketCollapsed().feedback} onToggle={() => toggleBucket("feedback")}>
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
        <SessionCardBucket title="Ready For Review" count={reviewSessions().length} empty="No completed sessions are waiting." collapsed={!!bucketCollapsed().review} onToggle={() => toggleBucket("review")}>
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
        <SessionCardBucket title="In Progress" count={progressSessions().length} empty="No sessions are running." collapsed={!!bucketCollapsed().progress} onToggle={() => toggleBucket("progress")}>
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
        <SessionCardBucket title="Inactive Sessions" count={inactiveSessions().length} empty="No inactive sessions." collapsed={!!bucketCollapsed().inactive} onToggle={() => toggleBucket("inactive")}>
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
  return (
    <CardContextMenu actions={[
      { label: "Edit", icon: "pencil", onSelect: props.editView },
      { label: "Delete", icon: "trash", danger: true, onSelect: props.deleteView },
    ]}>
      {(openMenu) => (
        <article
          class="dashboard-item-card dashboard-status-card interactive"
          classList={{ [`status-${status().replaceAll("_", "-")}`]: true }}
          onContextMenu={openMenu}
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
