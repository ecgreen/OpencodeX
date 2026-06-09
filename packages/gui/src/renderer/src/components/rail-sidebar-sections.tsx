import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import { title } from "../lib/format"
import { moveRelative } from "../lib/reorder"
import type { GuiSnapshot } from "../lib/store"
import { RailSection } from "./chrome"
import { Icon } from "./icon"
import { SidebarSessionLink, SidebarViewLink } from "./rail-sidebar-links"
import type { RailDragTarget, RailDropTarget } from "./rail-sidebar-types"

const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
const PROJECT_RECENT_SESSION_LIMIT = 4
type ProjectDragPreviewState = { id: string; x: number; y: number; width: number; height: number }
type ProjectRow =
  | { type: "project"; project: GuiSnapshot["projects"][number] }
  | { type: "placeholder"; id: string; height: number }

export function RailPinnedSection(props: {
  snapshot?: GuiSnapshot
  sessions: Session[]
  views: GuiSnapshot["views"]
  collapsed: boolean
  activeSessionID: string
  activeViewID?: string
  activeViewRoute: boolean
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  toggle: () => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  toggleViewPinned: (viewID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: "pinned" | "projects" | "recent" | "views", targetID?: "pinned" | "projects" | "recent" | "views", placement?: "before" | "after") => void
  reorderSection: (sourceID: "pinned" | "projects" | "recent" | "views", targetID: "pinned" | "projects" | "recent" | "views", placement: "before" | "after") => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const count = createMemo(() => props.sessions.length + props.views.length)
  return (
    <RailSection
      title="Pinned"
      count={count()}
      collapsed={props.collapsed}
      toggle={props.toggle}
      drag={sectionDrag("pinned", props)}
    >
      <For each={props.sessions}>
        {(session) => (
          <SidebarSessionLink
            session={session}
            snapshot={props.snapshot}
            active={props.activeSessionID === session.id}
            pinned
            onClick={() => props.openSession(session.id)}
            togglePinned={() => props.toggleSessionPinned(session.id)}
          />
        )}
      </For>
      <For each={props.views}>
        {(view) => (
          <SidebarViewLink
            view={view}
            snapshot={props.snapshot}
            active={props.activeViewRoute && props.activeViewID === view.id}
            pinned
            onClick={() => props.openView(view.id)}
            togglePinned={() => props.toggleViewPinned(view.id)}
          />
        )}
      </For>
    </RailSection>
  )
}

export function RailProjectsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  projectVisualOrder: readonly string[]
  projectSessions: (project: GuiSnapshot["projects"][number]) => Session[]
  projectExpanded: (projectID: string) => boolean
  sessionPinned: (sessionID: string) => boolean
  toggle: () => void
  toggleProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  openSession: (sessionID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: "pinned" | "projects" | "recent" | "views", targetID?: "pinned" | "projects" | "recent" | "views", placement?: "before" | "after") => void
  reorderSection: (sourceID: "pinned" | "projects" | "recent" | "views", targetID: "pinned" | "projects" | "recent" | "views", placement: "before" | "after") => void
  projectPointerDrag: (sourceID: string, targetID?: string, placement?: "before" | "after") => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
  dropProject: (targetID: string, placement: "before" | "after") => void
  moveProject: (projectID: string, offset: number) => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const [projectDragPreview, setProjectDragPreview] = createSignal<ProjectDragPreviewState>()
  const orderedProjects = createMemo(() => {
    const items = props.snapshot?.projects ?? []
    if (props.projectVisualOrder.length === 0) return items
    const byID = new Map(items.map((project) => [project.id, project]))
    const ordered = props.projectVisualOrder.map((id) => byID.get(id)).filter((project): project is GuiSnapshot["projects"][number] => project !== undefined)
    const orderedIDs = new Set(ordered.map((project) => project.id))
    return [...ordered, ...items.filter((project) => !orderedIDs.has(project.id))]
  })
  const projectRows = createMemo<ProjectRow[]>(() => {
    const items = orderedProjects()
    const source = props.dragTarget?.type === "project" ? props.dragTarget.id : undefined
    const target = props.dropTarget?.type === "project" ? props.dropTarget : undefined
    if (!source) return items.map((project) => ({ type: "project", project }))
    const byID = new Map(items.map((project) => [project.id, project]))
    const ids = target
      ? moveRelative(items.map((project) => project.id), source, target.id, target.placement)
      : items.map((project) => project.id)
    return (ids.length === 0 ? items.map((project) => project.id) : ids).flatMap((id): ProjectRow[] => {
      if (id === source) return [{ type: "placeholder", id: source, height: projectDragPreview()?.height ?? 42 }]
      const project = byID.get(id)
      return project ? [{ type: "project", project }] : []
    })
  })
  const previewProject = createMemo(() => (props.snapshot?.projects ?? []).find((project) => project.id === projectDragPreview()?.id))
  const previewSessions = createMemo(() => {
    const project = previewProject()
    if (!project || !props.projectExpanded(project.id)) return []
    return recentProjectSessions(props.projectSessions(project)).slice(0, 3)
  })
  let projectRowRects = new Map<string, DOMRect>()
  let projectAnimationFrame = 0
  createEffect(() => {
    const signature = projectRows().map(projectRowKey).join("\n")
    const active = props.dragTarget?.type === "project"
    cancelAnimationFrame(projectAnimationFrame)
    projectAnimationFrame = requestAnimationFrame(() => {
      projectRowRects = animateLayoutRows("[data-rail-project-row-id]", projectRowRects, active)
      void signature
    })
  })

  return (
    <RailSection
      title="Projects"
      count={props.snapshot?.projects.length ?? 0}
      collapsed={props.collapsed}
      toggle={props.toggle}
      action={props.createProject}
      drag={sectionDrag("projects", props)}
    >
      <For each={projectRows()}>
        {(row) => row.type === "placeholder" ? (
          <div class="project-drop-placeholder" data-rail-project-row-id="placeholder" style={{ height: `${row.height}px` }} />
        ) : (
          <div
            class="project-group"
            data-rail-project-id={row.project.id}
            data-rail-project-row-id={row.project.id}
            classList={{
              dropping: props.dropTarget?.type === "project" && props.dropTarget.id === row.project.id,
              "drop-after": props.dropTarget?.type === "project" && props.dropTarget.id === row.project.id && props.dropTarget.placement === "after",
            }}
            onDragOver={(event) => props.dragOver(event, { type: "project", id: row.project.id })}
            onDrop={(event) => props.dropProject(row.project.id, dropPlacement(event))}
          >
            <div
              class="project-heading"
              onPointerDown={(event) => startProjectPointerDrag(event, row.project.id, props, setProjectDragPreview)}
            >
              <button class="project-toggle" title={`${props.projectExpanded(row.project.id) ? "Collapse" : "Expand"} project`} aria-expanded={props.projectExpanded(row.project.id)} onClick={() => props.toggleProject(row.project.id)}><Icon name={props.projectExpanded(row.project.id) ? "folder-open" : "folder"} /></button>
              <button
                class="project-title"
                title={`${props.projectExpanded(row.project.id) ? "Collapse" : "Expand"} project. Alt+Up/Down moves it.`}
                aria-expanded={props.projectExpanded(row.project.id)}
                onClick={() => props.toggleProject(row.project.id)}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                  event.preventDefault()
                  props.moveProject(row.project.id, event.key === "ArrowUp" ? -1 : 1)
                }}
              >{title(row.project.name ?? row.project.project.name)}</button>
              <button class="project-new" title="New session in project" onClick={() => props.createSession(row.project.id, row.project.folders[0]?.path)}>+ New</button>
            </div>
            <div class="project-sessions" classList={{ collapsed: !props.projectExpanded(row.project.id) }}>
              <div>
                <For each={recentProjectSessions(props.projectSessions(row.project))} fallback={(
                  <div class="project-empty">
                    <span>No sessions in this project yet.</span>
                    <button onClick={() => props.createSession(row.project.id, row.project.folders[0]?.path)}>Create session</button>
                  </div>
                )}>
                  {(session) => (
                    <SidebarSessionLink
                      session={session}
                      snapshot={props.snapshot}
                      active={props.activeSessionID === session.id}
                      nested
                      pinned={props.sessionPinned(session.id)}
                      onClick={() => props.openSession(session.id)}
                      togglePinned={() => props.toggleSessionPinned(session.id)}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </For>
      <ProjectDragPreview
        preview={projectDragPreview()}
        project={previewProject()}
        sessions={previewSessions()}
        expanded={previewProject() ? props.projectExpanded(previewProject()!.id) : false}
      />
    </RailSection>
  )

  function startProjectPointerDrag(
    event: PointerEvent & { currentTarget: HTMLElement },
    projectID: string,
    handlers: Pick<typeof props, "projectPointerDrag" | "reorderProject" | "clearDragTarget">,
    setPreview: (value?: ProjectDragPreviewState) => void,
  ) {
    if (event.button !== 0) return
    const pointerID = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const sourceElement = event.currentTarget.closest<HTMLElement>("[data-rail-project-id]")
    const sourceRect = sourceElement?.getBoundingClientRect()
    const headingRect = event.currentTarget.getBoundingClientRect()
    const offset = { x: event.clientX - headingRect.left, y: event.clientY - headingRect.top }
    let dragging = false
    let target: { id: string; placement: "before" | "after" } | undefined
    let lastTargetKey = ""

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return
      dragging = true
      moveEvent.preventDefault()
      setPreview({
        id: projectID,
        x: moveEvent.clientX - offset.x,
        y: moveEvent.clientY - offset.y,
        width: sourceRect?.width ?? headingRect.width,
        height: sourceRect?.height ?? headingRect.height,
      })
      const nextTarget = projectDropTargetFromPointer(event.currentTarget.closest(".rail-section"), projectID, moveEvent.clientY)
      if (!nextTarget) {
        target = undefined
        if (lastTargetKey !== "") {
          handlers.projectPointerDrag(projectID)
          lastTargetKey = ""
        }
        return
      }
      target = nextTarget
      const targetKey = `${target.id}:${target.placement}`
      if (targetKey === lastTargetKey) return
      lastTargetKey = targetKey
      handlers.projectPointerDrag(projectID, target.id, target.placement)
    }

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      if (!dragging) return
      upEvent.preventDefault()
      document.addEventListener("click", suppressNextClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener("click", suppressNextClick, true), 250)
      if (!target) {
        setPreview(undefined)
        handlers.clearDragTarget()
        return
      }
      handlers.reorderProject(projectID, target.id, target.placement)
      setPreview(undefined)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      setPreview(undefined)
      handlers.clearDragTarget()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }
}

function suppressNextClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function ProjectDragPreview(props: {
  preview?: ProjectDragPreviewState
  project?: GuiSnapshot["projects"][number]
  sessions: Session[]
  expanded: boolean
}) {
  return (
    <Show when={props.preview && props.project}>
      <Portal>
        <div
          class="project-drag-preview"
          style={{ left: `${props.preview?.x ?? 0}px`, top: `${props.preview?.y ?? 0}px`, width: `${props.preview?.width ?? 262}px` }}
        >
          <div class="project-drag-preview-heading">
            <span class="project-drag-preview-icon"><Icon name={props.expanded ? "folder-open" : "folder"} /></span>
            <strong>{title(props.project?.name ?? props.project?.project.name ?? "")}</strong>
          </div>
          <Show when={props.expanded && props.sessions.length > 0}>
            <div class="project-drag-preview-sessions">
              <For each={props.sessions}>
                {(session) => <span>{title(session.title)}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  )
}

export function RailRecentSessionsSection(props: {
  sessions: Session[]
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  sessionPinned: (sessionID: string) => boolean
  toggle: () => void
  createSession: () => void
  openSession: (sessionID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: "pinned" | "projects" | "recent" | "views", targetID?: "pinned" | "projects" | "recent" | "views", placement?: "before" | "after") => void
  reorderSection: (sourceID: "pinned" | "projects" | "recent" | "views", targetID: "pinned" | "projects" | "recent" | "views", placement: "before" | "after") => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const recentSessions = createMemo(() => props.sessions.filter((session) => !props.sessionPinned(session.id) && isRecentSessionUpdate(session.time.updated)))
  return (
    <RailSection
      title="Recent Sessions"
      count={recentSessions().length}
      collapsed={props.collapsed}
      toggle={props.toggle}
      action={props.createSession}
      drag={sectionDrag("recent", props)}
    >
      <For each={recentSessions()}>
        {(session) => (
          <SidebarSessionLink
            session={session}
            snapshot={props.snapshot}
            active={props.activeSessionID === session.id}
            pinned={props.sessionPinned(session.id)}
            onClick={() => props.openSession(session.id)}
            togglePinned={() => props.toggleSessionPinned(session.id)}
          />
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
  dropTarget?: RailDropTarget
  viewPinned: (viewID: string) => boolean
  toggle: () => void
  createView: () => void
  openView: (viewID: string) => void
  toggleViewPinned: (viewID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: "pinned" | "projects" | "recent" | "views", targetID?: "pinned" | "projects" | "recent" | "views", placement?: "before" | "after") => void
  reorderSection: (sourceID: "pinned" | "projects" | "recent" | "views", targetID: "pinned" | "projects" | "recent" | "views", placement: "before" | "after") => void
  dropView: (targetID: string, placement: "before" | "after") => void
  moveView: (viewID: string, offset: number) => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const views = createMemo(() => (props.snapshot?.views ?? []).slice(0, 8))
  return (
    <RailSection
      title="Views"
      count={views().length}
      collapsed={props.collapsed}
      toggle={props.toggle}
      action={props.createView}
      drag={sectionDrag("views", props)}
    >
      <For each={views()}>
        {(view) => (
          <div
            class="draggable-row"
            classList={{
              dragging: props.dragTarget?.type === "view" && props.dragTarget.id === view.id,
              dropping: props.dropTarget?.type === "view" && props.dropTarget.id === view.id,
              "drop-after": props.dropTarget?.type === "view" && props.dropTarget.id === view.id && props.dropTarget.placement === "after",
            }}
            draggable
            onDragOver={(event) => props.dragOver(event, { type: "view", id: view.id })}
            onDrop={(event) => props.dropView(view.id, dropPlacement(event))}
            onDragStart={(event) => props.startDrag(event, { type: "view", id: view.id })}
            onDragEnd={props.clearDragTarget}
          >
            <div
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                event.preventDefault()
                props.moveView(view.id, event.key === "ArrowUp" ? -1 : 1)
              }}
            >
              <SidebarViewLink
                view={view}
                snapshot={props.snapshot}
                active={props.active && props.activeViewID === view.id}
                pinned={props.viewPinned(view.id)}
                onClick={() => props.openView(view.id)}
                togglePinned={() => props.toggleViewPinned(view.id)}
              />
            </div>
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

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

function sectionDrag(
  id: "pinned" | "projects" | "recent" | "views",
  props: {
    dragTarget?: RailDragTarget
    dropTarget?: RailDropTarget
    startDrag: (event: DragEvent, target: RailDragTarget) => void
    dragOver: (event: DragEvent, target: RailDragTarget) => void
    clearDragTarget: () => void
    sectionPointerDrag: (sourceID: "pinned" | "projects" | "recent" | "views", targetID?: "pinned" | "projects" | "recent" | "views", placement?: "before" | "after") => void
    reorderSection: (sourceID: "pinned" | "projects" | "recent" | "views", targetID: "pinned" | "projects" | "recent" | "views", placement: "before" | "after") => void
    dropSection: (targetID: string, placement: "before" | "after") => void
    moveSection: (offset: number) => void
  },
) {
  return {
    target: { type: "section" as const, id },
    active: props.dragTarget?.type === "section" && props.dragTarget.id === id,
    dropping: props.dropTarget?.type === "section" && props.dropTarget.id === id ? props.dropTarget.placement : undefined,
    start: props.startDrag,
    over: props.dragOver,
    drop: props.dropSection,
    clear: props.clearDragTarget,
    move: props.moveSection,
    pointerDrag: props.sectionPointerDrag,
    pointerDrop: props.reorderSection,
  }
}

function projectRowKey(row: ProjectRow) {
  return row.type === "project" ? row.project.id : "placeholder"
}

function projectDropTargetFromPointer(root: Element | null, sourceID: string, clientY: number) {
  const elements = Array.from((root ?? document).querySelectorAll<HTMLElement>("[data-rail-project-id]"))
    .filter((element) => element.dataset.railProjectId !== sourceID)
  if (elements.length === 0) return
  const first = elements[0]
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    const id = element.dataset.railProjectId
    if (!id) continue
    if (clientY < rect.top + rect.height / 2) return { id, placement: "before" as const }
  }
  const last = elements.at(-1)
  const id = last?.dataset.railProjectId
  return id ? { id, placement: "after" as const } : first.dataset.railProjectId ? { id: first.dataset.railProjectId, placement: "before" as const } : undefined
}

function animateLayoutRows(selector: string, previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const key = element.dataset.railProjectRowId
    if (!key) continue
    const animations = element.getAnimations()
    const animatedRect = enabled && animations.length > 0 ? element.getBoundingClientRect() : undefined
    animations.forEach((animation) => animation.cancel())
    const rect = element.getBoundingClientRect()
    next.set(key, rect)
    const before = animatedRect ?? previous.get(key)
    if (!enabled || !before) continue
    const deltaY = before.top - rect.top
    if (Math.abs(deltaY) < 1) continue
    element.animate([
      { transform: `translateY(${deltaY}px)` },
      { transform: "translateY(0)" },
    ], {
      duration: 220,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    })
  }
  return next
}
