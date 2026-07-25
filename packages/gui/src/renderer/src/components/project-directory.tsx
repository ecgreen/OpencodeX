import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, type SessionOrderState } from "../lib/app-session-lists"
import { projectLatestActivity, projectSwarms, projectViews } from "../lib/project-summary"
import { moveRelative } from "../lib/reorder"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { Button, TextInput } from "./ui"
import { CardActionMenu } from "./card-action-menu"

type ProjectDirectoryRowItem =
  | { type: "project"; project: GuiSnapshot["projects"][number] }
  | { type: "placeholder"; id: string; height: number }

type ProjectDragPreviewState = {
  id: string
  x: number
  y: number
  width: number
}

export function ProjectsOverview(props: {
  projects: GuiSnapshot["projects"]
  filteredProjects: GuiSnapshot["projects"]
  query: string
  setQuery: (value: string) => void
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  overview: { attention: number; sessions: number; swarms: number; views: number }
  openProject: (projectID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
}) {
  const [movingProject, setMovingProject] = createSignal<{ id: string; direction: "up" | "down"; token: number }>()
  const [dragProjectID, setDragProjectID] = createSignal("")
  const [dropTarget, setDropTarget] = createSignal<{ id: string; placement: "before" | "after" }>()
  const [dragPreview, setDragPreview] = createSignal<ProjectDragPreviewState>()
  const [dragPlaceholderHeight, setDragPlaceholderHeight] = createSignal(72)
  const [suppressedOpenProjectID, setSuppressedOpenProjectID] = createSignal("")
  const visibleProjectIDs = createMemo(() => props.filteredProjects.map((project) => project.id))
  const projectRows = createMemo<ProjectDirectoryRowItem[]>(() => {
    const source = dragProjectID()
    const target = dropTarget()
    if (!source) return props.filteredProjects.map((project) => ({ type: "project", project }))
    const byID = new Map(props.filteredProjects.map((project) => [project.id, project]))
    const ids = target ? moveRelative(visibleProjectIDs(), source, target.id, target.placement) : visibleProjectIDs()
    return (ids.length === 0 ? visibleProjectIDs() : ids).flatMap((id): ProjectDirectoryRowItem[] => {
      if (id === source) return [{ type: "placeholder", id: source, height: dragPlaceholderHeight() }]
      const project = byID.get(id)
      return project ? [{ type: "project", project }] : []
    })
  })
  const previewProject = createMemo(() => props.projects.find((project) => project.id === dragPreview()?.id))
  let projectRowRects = new Map<string, DOMRect>()
  let projectAnimationFrame = 0
  createEffect(() => {
    const signature = projectRows().map(projectDirectoryRowKey).join("\n")
    const active = dragProjectID() !== ""
    cancelAnimationFrame(projectAnimationFrame)
    projectAnimationFrame = requestAnimationFrame(() => {
      projectRowRects = animateProjectDirectoryRows(projectRowRects, active)
      void signature
    })
  })

  function moveProject(projectID: string, offset: number) {
    setMovingProject({ id: projectID, direction: offset < 0 ? "up" : "down", token: Date.now() })
    window.setTimeout(() => {
      setMovingProject((current) => current?.id === projectID ? undefined : current)
    }, 360)
    props.moveProject(projectID, offset)
  }

  return (
    <div class="page project-command-page">
      <header class="project-directory-header">
        <div>
          <p class="eyebrow">Projects</p>
          <h1>Workspace directory</h1>
          <p>Choose a project, start a focused session, or update the folders that define a workspace.</p>
        </div>
        <Button appearance="solid" tone="accent" icon="plus" onClick={props.createProject}>Create project</Button>
      </header>

      <section class="project-directory-summary" aria-label="Project summary">
        <ProjectSummaryItem label="Projects" value={props.projects.length} />
        <ProjectSummaryItem label="Sessions" value={props.overview.sessions} />
        <ProjectSummaryItem label="Attention" value={props.overview.attention} tone={props.overview.attention > 0 ? "warning" : "neutral"} />
        <ProjectSummaryItem label="Swarms" value={props.overview.swarms} />
        <ProjectSummaryItem label="Views" value={props.overview.views} />
      </section>

      <section class="project-directory-panel">
        <header>
          <div>
            <h2>Projects</h2>
            <span>{props.filteredProjects.length} shown</span>
          </div>
          <div class="project-directory-search">
            <Icon name="search" />
            <TextInput type="search" aria-label="Search projects or folders" value={props.query} placeholder="Search projects or folders" onInput={(event) => props.setQuery(event.currentTarget.value)} />
          </div>
        </header>
        <div class="project-directory-list">
          <For each={projectRows()} fallback={<ProjectEmptyState empty={props.projects.length === 0} createProject={props.createProject} />}>
            {(row) => row.type === "placeholder" ? (
              <div
                class="project-directory-drop-placeholder"
                data-project-row-layout-id="placeholder"
                style={{ height: `${row.height}px` }}
              />
            ) : (
              <ProjectDirectoryRow
                project={row.project}
                snapshot={props.snapshot}
                sessionOrderState={props.sessionOrderState}
                projects={props.projects}
                openProject={(projectID) => {
                  if (suppressedOpenProjectID() === projectID) return
                  props.openProject(projectID)
                }}
                createSession={props.createSession}
                editProject={props.editProject}
                deleteProject={props.deleteProject}
                moveProject={moveProject}
                moving={movingProject()?.id === row.project.id ? movingProject()?.direction : undefined}
                dragging={dragProjectID() === row.project.id}
                dropping={dropTarget()?.id === row.project.id ? dropTarget()?.placement : undefined}
                startPointerDrag={(event) => startProjectPointerDrag(event, row.project.id)}
              />
            )}
          </For>
          <ProjectDragPreview preview={dragPreview()} project={previewProject()} snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} />
        </div>
      </section>
    </div>
  )

  function startProjectPointerDrag(event: PointerEvent & { currentTarget: HTMLElement }, sourceID: string) {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(".project-directory-actions")) return
    const pointerID = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let dragging = false
    let target: { id: string; placement: "before" | "after" } | undefined
    let lastTargetKey = ""

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return
      dragging = true
      moveEvent.preventDefault()
      setDragProjectID(sourceID)
      setDragPlaceholderHeight(rect.height)
      setDragPreview({
        id: sourceID,
        x: moveEvent.clientX - offset.x,
        y: moveEvent.clientY - offset.y,
        width: rect.width,
      })
      const nextTarget = projectDropTargetFromPointer(sourceID, moveEvent.clientY)
      if (!nextTarget) {
        target = undefined
        if (lastTargetKey !== "") {
          setDropTarget(undefined)
          lastTargetKey = ""
        }
        return
      }
      target = nextTarget
      const targetKey = `${target.id}:${target.placement}`
      if (targetKey === lastTargetKey) return
      lastTargetKey = targetKey
      setDropTarget(target)
    }

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      if (!dragging) return
      upEvent.preventDefault()
      setSuppressedOpenProjectID(sourceID)
      window.setTimeout(() => setSuppressedOpenProjectID((current) => current === sourceID ? "" : current), 250)
      setDragProjectID("")
      setDropTarget(undefined)
      setDragPreview(undefined)
      if (!target) return
      const ordered = moveRelative(visibleProjectIDs(), sourceID, target.id, target.placement)
      const sourceIndex = visibleProjectIDs().indexOf(sourceID)
      const targetIndex = ordered.indexOf(sourceID)
      if (targetIndex !== -1 && sourceIndex !== -1) {
        setMovingProject({ id: sourceID, direction: targetIndex < sourceIndex ? "up" : "down", token: Date.now() })
        window.setTimeout(() => {
          setMovingProject((current) => current?.id === sourceID ? undefined : current)
        }, 360)
      }
      props.reorderProject(sourceID, target.id, target.placement)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      setDragProjectID("")
      setDropTarget(undefined)
      setDragPreview(undefined)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }
}

function ProjectDirectoryRow(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  projects: GuiSnapshot["projects"]
  openProject: (projectID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  moveProject: (projectID: string, offset: number) => void
  moving?: "up" | "down"
  dragging: boolean
  dropping?: "before" | "after"
  startPointerDrag: (event: PointerEvent & { currentTarget: HTMLElement }) => void
}) {
  const name = () => projectLabel(props.project)
  const actions = () => [
    { label: "New session", icon: "session" as const, onSelect: () => props.createSession(props.project.id, props.project.folders[0]?.path) },
    { label: "Move up", icon: "arrowUp" as const, disabled: projectIndex(props.projects, props.project.id) <= 0, onSelect: () => props.moveProject(props.project.id, -1) },
    { label: "Move down", icon: "arrowDown" as const, disabled: projectIndex(props.projects, props.project.id) >= props.projects.length - 1, onSelect: () => props.moveProject(props.project.id, 1) },
    { label: "Edit project", icon: "pencil" as const, onSelect: () => props.editProject(props.project.id, name(), props.project.folders.map((folder) => folder.path)) },
    { label: "Delete project", icon: "trash" as const, danger: true, onSelect: () => props.deleteProject(props.project.id, name()) },
  ].filter((action) => !action.disabled)
  return (
    <article
      class="project-directory-row"
      classList={{
        "moving-up": props.moving === "up",
        "moving-down": props.moving === "down",
        dragging: props.dragging,
        dropping: props.dropping !== undefined,
        "drop-after": props.dropping === "after",
      }}
      data-project-row-id={props.project.id}
      data-project-row-layout-id={props.project.id}
      onPointerDown={props.startPointerDrag}
    >
      <Button appearance="ghost" class="project-directory-open" onClick={() => props.openProject(props.project.id)}>
        <span class="project-directory-icon"><Icon name="folder-open" /></span>
        <span>
          <strong>{name()}</strong>
          <small>{projectFolderPreview(props.project)}</small>
        </span>
      </Button>
      <ProjectDirectoryMeta project={props.project} snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} />
      <div class="project-directory-actions">
        <CardActionMenu label={name()} actions={actions()} />
      </div>
    </article>
  )
}

function ProjectDirectoryMeta(props: { project: GuiSnapshot["projects"][number]; snapshot?: GuiSnapshot; sessionOrderState?: SessionOrderState }) {
  return (
    <div class="project-directory-meta">
      <span>{projectSessions(props.project, props.snapshot, props.sessionOrderState).length + props.project.terminalSessions.length} sessions</span>
      <span>{projectSwarms(props.project, props.snapshot).length} swarms</span>
      <span>{projectViews(props.project, props.snapshot, props.sessionOrderState).length} views</span>
      <span>{formatActivity(projectLatestActivity(props.project, props.snapshot, props.sessionOrderState))}</span>
    </div>
  )
}

function ProjectDragPreview(props: { preview?: ProjectDragPreviewState; project?: GuiSnapshot["projects"][number]; snapshot?: GuiSnapshot; sessionOrderState?: SessionOrderState }) {
  return (
    <Show when={props.preview && props.project}>
      <Portal>
        <div
          class="project-directory-drag-preview"
          style={{ left: `${props.preview?.x ?? 0}px`, top: `${props.preview?.y ?? 0}px`, width: `${props.preview?.width ?? 320}px` }}
        >
          <span class="project-directory-icon"><Icon name="folder-open" /></span>
          <span>
            <strong>{props.project ? projectLabel(props.project) : ""}</strong>
            <small>{props.project ? projectFolderPreview(props.project) : ""}</small>
          </span>
          <Show when={props.project}>
            {(project) => <ProjectDirectoryMeta project={project()} snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} />}
          </Show>
        </div>
      </Portal>
    </Show>
  )
}


function ProjectSummaryItem(props: { label: string; value: number | string; tone?: "neutral" | "warning" }) {
  return (
    <div class="project-summary-item" data-tone={props.tone ?? "neutral"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function ProjectEmptyState(props: { empty: boolean; createProject: () => void }) {
  return (
    <div class="project-directory-empty">
      <Icon name={props.empty ? "folder-open" : "search"} />
      <strong>{props.empty ? "Create your first project" : "No projects match this search"}</strong>
      <span>{props.empty ? "Select one or more folders to make a workspace you can start from quickly." : "Try a different project name or folder path."}</span>
      <Show when={props.empty}>
        <Button appearance="solid" tone="accent" icon="plus" onClick={props.createProject}>Create project</Button>
      </Show>
    </div>
  )
}

export function projectLabel(project: GuiSnapshot["projects"][number]) {
  return title(project.name ?? project.project.name)
}

function projectFolderPreview(project: GuiSnapshot["projects"][number]) {
  return project.folders.map((folder) => compactPath(folder.path)).join(", ") || "No folders"
}

function projectIndex(projects: GuiSnapshot["projects"], projectID: string) {
  return projects.findIndex((project) => project.id === projectID)
}

function formatActivity(value: number) {
  return value > 0 ? formatRelative(value) : "never"
}


function projectDirectoryRowKey(row: ProjectDirectoryRowItem) {
  return row.type === "project" ? row.project.id : `placeholder:${row.id}:${row.height}`
}

function animateProjectDirectoryRows(previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>("[data-project-row-layout-id]")) {
    const key = element.dataset.projectRowLayoutId
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

function projectDropTargetFromPointer(sourceID: string, clientY: number) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-project-row-id]"))
    .filter((element) => element.dataset.projectRowId !== sourceID)
  const before = rows.find((element) => {
    const rect = element.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2
  })
  if (before?.dataset.projectRowId) return { id: before.dataset.projectRowId, placement: "before" as const }
  const after = rows.at(-1)?.dataset.projectRowId
  return after ? { id: after, placement: "after" as const } : undefined
}
