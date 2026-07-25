import { Button, IconButton } from "./ui"
import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { projectSessionPreviewItems, sessionOrderBucket } from "../lib/app-session-lists"
import { title } from "../lib/format"
import { moveRelative } from "../lib/reorder"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { ProjectDragPreview, type ProjectDragPreviewState } from "./rail-project-drag-preview"
import { RailSection } from "./rail-section"
import { dropPlacement, sectionDrag, suppressNextPointerClick } from "./rail-sidebar-drag"
import { SidebarSessionLink, SidebarTerminalSessionLink } from "./rail-sidebar-links"
import { animateLayoutRows } from "./rail-sidebar-motion"
import type { RailDragTarget, RailDropTarget, RailSectionName } from "./rail-sidebar-types"

type ProjectRow =
  | { type: "project"; project: GuiSnapshot["projects"][number] }
  | { type: "placeholder"; id: string; height: number }

export function RailProjectsSection(props: {
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  activeTerminalSessionID: string
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
  createTerminalSession: (projectID?: string, directory?: string) => void
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  renameTerminalSession: (session: OpencodeXTerminalSession) => void
  removeTerminalSession: (session: OpencodeXTerminalSession) => void
  terminalStatus: (session: OpencodeXTerminalSession) => string
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
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
    return recentProjectSessions(props.projectSessions(project), props.snapshot).slice(0, 3)
  })
  const pointerDragCleanups = new Set<() => void>()
  let projectRowRects = new Map<string, DOMRect>()
  let stopClickSuppression: (() => void) | undefined

  onCleanup(() => {
    pointerDragCleanups.forEach((cleanup) => cleanup())
    stopClickSuppression?.()
  })

  createEffect(() => {
    const signature = projectRows().map(projectRowKey).join("\n")
    const active = props.dragTarget?.type === "project"
    const frame = requestAnimationFrame(() => {
      projectRowRects = animateLayoutRows("[data-rail-project-row-id]", projectRowRects, active)
      void signature
    })
    onCleanup(() => cancelAnimationFrame(frame))
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
              classList={{ running: hasRunningProjectSession(props.projectSessions(row.project), props.snapshot) }}
              onPointerDown={(event) => startProjectPointerDrag(event, row.project.id)}
            >
              <Button appearance="ghost" class="project-toggle" title={`${props.projectExpanded(row.project.id) ? "Collapse" : "Expand"} project`} aria-expanded={props.projectExpanded(row.project.id)} onClick={() => props.toggleProject(row.project.id)}><Icon name={props.projectExpanded(row.project.id) ? "folder-open" : "folder"} /></Button>
              <Button appearance="ghost"
                class="project-title"
                title={`${props.projectExpanded(row.project.id) ? "Collapse" : "Expand"} project. Alt+Up/Down moves it.`}
                aria-expanded={props.projectExpanded(row.project.id)}
                onClick={() => props.toggleProject(row.project.id)}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                  event.preventDefault()
                  props.moveProject(row.project.id, event.key === "ArrowUp" ? -1 : 1)
                }}
              >{title(row.project.name ?? row.project.project.name)}</Button>
              <IconButton
                appearance="soft"
                tone="accent"
                size="compact"
                icon="plus"
                class="project-new"
                label={`New session in ${title(row.project.name ?? row.project.project.name)}`}
                onClick={() => props.createSession(row.project.id, row.project.folders[0]?.path)}
              />
            </div>
            <div class="project-sessions" classList={{ collapsed: !props.projectExpanded(row.project.id) }}>
              <div>
                <Show when={props.projectExpanded(row.project.id)}>
                  <Show
                    when={recentProjectSessions(props.projectSessions(row.project), props.snapshot).length + row.project.terminalSessions.length > 0}
                    fallback={(
                      <div class="project-empty">
                        <span>No sessions in this project yet.</span>
                        <Button appearance="ghost" onClick={() => props.createSession(row.project.id, row.project.folders[0]?.path)}>Create session</Button>
                        <Button appearance="ghost" onClick={() => props.createTerminalSession(row.project.id, row.project.folders[0]?.path)}>Start Claude Code</Button>
                      </div>
                    )}
                  >
                    <For each={recentProjectSessions(props.projectSessions(row.project), props.snapshot)}>
                      {(session) => (
                        <SidebarSessionLink
                          session={session}
                          snapshot={props.snapshot}
                          active={props.activeSessionID === session.id}
                          nested
                          pinned={props.sessionPinned(session.id)}
                          onClick={() => props.openSession(session.id)}
                          togglePinned={() => props.toggleSessionPinned(session.id)}
                          renameSession={() => props.renameSession(session)}
                          deleteSession={() => props.deleteSession(session)}
                        />
                      )}
                    </For>
                    <For each={row.project.terminalSessions.toSorted((a, b) => Number(b.timeUpdated) - Number(a.timeUpdated))}>
                      {(terminalSession) => (
                        <SidebarTerminalSessionLink
                          terminalSession={terminalSession}
                          status={props.terminalStatus(terminalSession)}
                          active={props.activeTerminalSessionID === terminalSession.id}
                          nested
                          pinned={props.sessionPinned(terminalSession.id)}
                          onClick={() => props.openTerminalSession(terminalSession.id)}
                          togglePinned={() => props.toggleSessionPinned(terminalSession.id)}
                          renameSession={() => props.renameTerminalSession(terminalSession)}
                          removeSession={() => props.removeTerminalSession(terminalSession)}
                        />
                      )}
                    </For>
                  </Show>
                </Show>
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

  function startProjectPointerDrag(event: PointerEvent & { currentTarget: HTMLElement }, projectID: string) {
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
      setProjectDragPreview({
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
          props.projectPointerDrag(projectID)
          lastTargetKey = ""
        }
        return
      }
      target = nextTarget
      const targetKey = `${target.id}:${target.placement}`
      if (targetKey === lastTargetKey) return
      lastTargetKey = targetKey
      props.projectPointerDrag(projectID, target.id, target.placement)
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      pointerDragCleanups.delete(cleanup)
    }

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerID) return
      cleanup()
      if (!dragging) return
      upEvent.preventDefault()
      stopClickSuppression?.()
      stopClickSuppression = suppressNextPointerClick()
      if (!target) {
        setProjectDragPreview(undefined)
        props.clearDragTarget()
        return
      }
      props.reorderProject(projectID, target.id, target.placement)
      setProjectDragPreview(undefined)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      cleanup()
      setProjectDragPreview(undefined)
      props.clearDragTarget()
    }

    pointerDragCleanups.add(cleanup)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }
}

function recentProjectSessions(sessions: Session[], snapshot?: GuiSnapshot) {
  return projectSessionPreviewItems(sessions, snapshot)
}

function hasRunningProjectSession(sessions: Session[], snapshot?: GuiSnapshot) {
  return sessions.some((session) => sessionOrderBucket(snapshot, session) === "in_progress")
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
  const id = elements.at(-1)?.dataset.railProjectId
  return id ? { id, placement: "after" as const } : first.dataset.railProjectId ? { id: first.dataset.railProjectId, placement: "before" as const } : undefined
}
