import type { JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, tuiSidebarSessions, type SessionOrderState } from "../lib/app-session-lists"
import { deriveSessionStatus, deriveViewStatus, isActiveSessionStatus, sessionStatusLabel, type DerivedSessionStatus } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/session-api"
import { projectViewSessionCount, projectViews } from "../lib/project-summary"
import { CardActionMenu } from "./card-action-menu"
import { Button } from "./ui"
import { CardContextMenu } from "./card-context-menu"
import { DashboardSection, Empty, EmptyCreateDashboardCard } from "./dashboard-primitives"
import { SidebarSessionLink } from "./rail-sidebar-links"

export function Dashboard(props: {
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  logo: JSX.Element
  openProject: (projectID: string) => void
  openSession: (sessionID: string) => void
  openSwarm: (swarmID: string) => void
  openView: (viewID: string) => void
  viewPinned: (viewID: string) => boolean
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: () => void
  createView: () => void
  toggleViewPinned: (viewID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, name: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot, props.sessionOrderState))
  const activeSessions = createMemo(() => sessions().filter((session) => isActiveSessionStatus(deriveSessionStatus(props.snapshot, session))))
  return (
    <div class="page dashboard-page">
      {props.logo}
      <section class="dashboard-sections">
        <DashboardSessionsSection sessions={activeSessions()} snapshot={props.snapshot} openSession={props.openSession} createSession={() => props.createSession()} renameSession={props.renameSession} deleteSession={props.deleteSession} />
        <DashboardViewsSection snapshot={props.snapshot} openView={props.openView} createView={props.createView} viewPinned={props.viewPinned} toggleViewPinned={props.toggleViewPinned} editView={props.editView} deleteView={props.deleteView} />
        <DashboardSwarmsSection snapshot={props.snapshot} createSwarm={props.createSwarm} openSwarm={props.openSwarm} />
        <DashboardProjectsSection snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} openProject={props.openProject} createProject={props.createProject} createSession={props.createSession} editProject={props.editProject} deleteProject={props.deleteProject} />
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
    <DashboardSection title="Projects" count={props.snapshot?.projects.length ?? 0} action="New" actionLabel="New project" onAction={props.createProject}>
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
        <article class="dashboard-item-card dashboard-summary-card dashboard-project-card interactive" onContextMenu={openMenu}>
          <Button appearance="ghost" class="dashboard-card-open" onClick={props.openProject}>
            <strong>{title(props.project.name ?? props.project.project.name)}</strong>
            <small>
              <span>{projectDashboardMeta(props.project, props.snapshot, sessions().length + props.project.terminalSessions.length)}</span>
            </small>
          </Button>
          <CardActionMenu label={title(props.project.name ?? props.project.project.name)} actions={actions()} />
        </article>
      )}
    </CardContextMenu>
  )
}

function DashboardSwarmsSection(props: { snapshot?: GuiSnapshot; createSwarm: () => void; openSwarm: (swarmID: string) => void }) {
  return (
    <DashboardSection title="Swarms" count={props.snapshot?.swarms.length ?? 0} action="New" actionLabel="New swarm" onAction={props.createSwarm}>
      <div class="dashboard-card-grid">
        <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create swarm" description="Build an agent team and pick it in the model selector like any model." onClick={props.createSwarm} />}>
          {(swarm) => (
            <Button appearance="ghost" class="dashboard-item-card dashboard-summary-card dashboard-swarm-card interactive" onClick={() => props.openSwarm(swarm.id)}>
              <div class="dashboard-card-copy">
                <strong>{title(swarm.title)}</strong>
                <small>
                  <span>{swarm.roles.slice(0, 4).map((role) => role.name).join(" · ")}{swarm.roles.length > 4 ? ` +${swarm.roles.length - 4}` : ""}</span>
                </small>
              </div>
              <footer>
                <small>{swarm.roles.length} roles · {formatRelative(swarm.timeUpdated)}</small>
              </footer>
            </Button>
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
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  createSession: () => void
}) {
  return (
    <DashboardSection title="Active sessions" count={props.sessions.length} action="New" actionLabel="New session" onAction={props.createSession}>
      <div class="dashboard-active-sessions">
        <For each={props.sessions} fallback={<Empty text="No active sessions." />}>
          {(session) => (
            <SidebarSessionLink
              session={session}
              snapshot={props.snapshot}
              active={false}
              onClick={() => props.openSession(session.id)}
              renameSession={() => props.renameSession(session)}
              deleteSession={() => props.deleteSession(session)}
            />
          )}
        </For>
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
    <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} action="New" actionLabel="New view" onAction={props.createView}>
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
          class="dashboard-item-card dashboard-summary-card dashboard-view-card interactive"
          classList={{ [`status-${status().replaceAll("_", "-")}`]: true }}
          onContextMenu={openMenu}
        >
          <Button appearance="ghost" class="dashboard-card-open" onClick={() => props.openView(props.view.id)}>
            <strong>{title(props.view.title)}</strong>
            <small>
              <span>{sessionStatusLabel(status())} · {viewDashboardMeta(props.view)}</span>
            </small>
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
  return `${formatRelative(view.timeUpdated)} · ${projectViewSessionCount(view)} sessions`
}

function projectDashboardMeta(project: GuiSnapshot["projects"][number], snapshot: GuiSnapshot | undefined, sessionCount: number) {
  return `${compactPath(project.folders[0]?.path ?? "")} · ${sessionCount} sessions · ${projectViews(project, snapshot).length} views`
}
