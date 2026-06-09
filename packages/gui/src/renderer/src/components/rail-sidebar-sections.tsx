import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, createMemo } from "solid-js"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { RailSection } from "./chrome"
import { Icon } from "./icon"
import { SidebarSessionLink, SidebarViewLink } from "./rail-sidebar-links"
import type { RailDragTarget } from "./rail-sidebar-types"

const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
const PROJECT_RECENT_SESSION_LIMIT = 4

export function RailProjectsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  dragTarget?: RailDragTarget
  projectSessions: (project: GuiSnapshot["projects"][number]) => Session[]
  projectExpanded: (projectID: string) => boolean
  toggle: () => void
  toggleProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  openSession: (sessionID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  dropProject: (targetID: string, placement: "before" | "after") => void
  moveProject: (projectID: string, offset: number) => void
}) {
  return (
    <RailSection title="Projects" count={props.snapshot?.projects.length ?? 0} collapsed={props.collapsed} toggle={props.toggle} action={props.createProject}>
      <For each={props.snapshot?.projects ?? []}>
        {(project) => (
          <div
            class="project-group"
            classList={{ dropping: props.dragTarget?.type === "project" && props.dragTarget.id !== project.id }}
            onDragOver={allowDrop}
            onDrop={(event) => props.dropProject(project.id, dropPlacement(event))}
          >
            <div class="project-heading">
              <button
                class="drag-handle"
                draggable
                title="Drag to reorder project. Alt+Up/Down also moves it."
                aria-label="Reorder project with drag or Alt+ArrowUp and Alt+ArrowDown"
                onDragStart={(event) => props.startDrag(event, { type: "project", id: project.id })}
                onDragEnd={props.clearDragTarget}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                  event.preventDefault()
                  props.moveProject(project.id, event.key === "ArrowUp" ? -1 : 1)
                }}
              ><Icon name="grip" /></button>
              <button class="project-toggle" title={`${props.projectExpanded(project.id) ? "Collapse" : "Expand"} project`} aria-expanded={props.projectExpanded(project.id)} onClick={() => props.toggleProject(project.id)}><Icon name={props.projectExpanded(project.id) ? "folder-open" : "folder"} /></button>
              <button class="project-title" title={`${props.projectExpanded(project.id) ? "Collapse" : "Expand"} project`} aria-expanded={props.projectExpanded(project.id)} onClick={() => props.toggleProject(project.id)}>{title(project.name ?? project.project.name)}</button>
              <button class="project-new" title="New session in project" onClick={() => props.createSession(project.id, project.folders[0]?.path)}>+ New</button>
            </div>
            <div class="project-sessions" classList={{ collapsed: !props.projectExpanded(project.id) }}>
              <div>
                <For each={recentProjectSessions(props.projectSessions(project))} fallback={(
                  <div class="project-empty">
                    <span>No sessions in this project yet.</span>
                    <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Create session</button>
                  </div>
                )}>
                  {(session) => (
                    <SidebarSessionLink session={session} snapshot={props.snapshot} active={props.activeSessionID === session.id} nested onClick={() => props.openSession(session.id)} />
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </For>
    </RailSection>
  )
}

export function RailRecentSessionsSection(props: {
  sessions: Session[]
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  toggle: () => void
  createSession: () => void
  openSession: (sessionID: string) => void
}) {
  const recentSessions = createMemo(() => props.sessions.filter((session) => isRecentSessionUpdate(session.time.updated)))
  return (
    <RailSection title="Recent Sessions" count={recentSessions().length} collapsed={props.collapsed} toggle={props.toggle} action={props.createSession}>
      <For each={recentSessions()}>
        {(session) => (
          <SidebarSessionLink session={session} snapshot={props.snapshot} active={props.activeSessionID === session.id} onClick={() => props.openSession(session.id)} />
        )}
      </For>
    </RailSection>
  )
}

export function RailViewsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  active: boolean
  activeViewID?: string
  dragTarget?: RailDragTarget
  toggle: () => void
  createView: () => void
  openView: (viewID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  dropView: (targetID: string, placement: "before" | "after") => void
  moveView: (viewID: string, offset: number) => void
}) {
  return (
    <RailSection title="Views" count={(props.snapshot?.views ?? []).length} collapsed={props.collapsed} toggle={props.toggle} action={props.createView}>
      <For each={(props.snapshot?.views ?? []).slice(0, 8)}>
        {(view) => (
          <div class="draggable-row" classList={{ dropping: props.dragTarget?.type === "view" && props.dragTarget.id !== view.id }} onDragOver={allowDrop} onDrop={(event) => props.dropView(view.id, dropPlacement(event))}>
            <button
              class="drag-handle"
              draggable
              title="Drag to reorder view. Alt+Up/Down also moves it."
              aria-label="Reorder view with drag or Alt+ArrowUp and Alt+ArrowDown"
              onDragStart={(event) => props.startDrag(event, { type: "view", id: view.id })}
              onDragEnd={props.clearDragTarget}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                event.preventDefault()
                props.moveView(view.id, event.key === "ArrowUp" ? -1 : 1)
              }}
            ><Icon name="grip" /></button>
            <SidebarViewLink view={view} snapshot={props.snapshot} active={props.active && props.activeViewID === view.id} onClick={() => props.openView(view.id)} />
          </div>
        )}
      </For>
    </RailSection>
  )
}

function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

function recentProjectSessions(sessions: Session[]) {
  const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
  const recent = sorted.filter((session) => isRecentSessionUpdate(session.time.updated))
  return recent.length >= PROJECT_RECENT_SESSION_LIMIT ? recent : sorted.slice(0, PROJECT_RECENT_SESSION_LIMIT)
}

function allowDrop(event: DragEvent) {
  event.preventDefault()
}

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}
