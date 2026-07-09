import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { compactPath, formatRelative, title } from "../lib/format"
import { projectSessions, sessionOrderBucket, type SessionOrderState } from "../lib/app-session-lists"
import { projectAttentionItems, projectLatestActivity, projectSwarms, projectViewSessionCount, projectViews } from "../lib/project-summary"
import { moveRelative } from "../lib/reorder"
import { sessionStatusLabel } from "../lib/session-status"
import { type GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { isRecentSessionUpdate, SessionCardBucket, SessionStatusCard } from "./session-card-list"
import { StatusPill } from "./status-pill"
import { Button, IconButton, TextInput } from "./ui"

type ProjectDirectoryRowItem =
  | { type: "project"; project: GuiSnapshot["projects"][number] }
  | { type: "placeholder"; id: string; height: number }

type ProjectDragPreviewState = {
  id: string
  x: number
  y: number
  width: number
}

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
  const projectBySessionID = createMemo(() => new Map(props.projects.flatMap((project) => project.sessions.map((session) => [session.id, title(project.name ?? project.project.name)] as const))))
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <h1>Session workspace</h1>
      <p>Open, monitor, and resume existing TUI-compatible sessions from the shared backend data model.</p>
      <For each={props.sessions} fallback={<Empty text="No sessions" />}>
        {(session) => (
          <article class="card-row">
            <div>
              <strong>{title(session.title)}</strong>
              <span>{[projectBySessionID().get(session.id), compactPath(session.directory)].filter(Boolean).join(" - ")}</span>
            </div>
            <div class="row-actions">
              <StatusPill status={props.sessionStatus[session.id]?.type ?? "idle"} />
              <Button size="sm" icon="session" onClick={() => props.openSession(session.id)}>Open</Button>
              <IconButton icon="pin" label={`${props.sessionPinned(session.id) ? "Unpin" : "Pin"} ${title(session.title)}`} pressed={props.sessionPinned(session.id)} onClick={() => props.toggleSessionPinned(session.id)} />
              <IconButton icon="pencil" label={`Rename ${title(session.title)}`} onClick={() => props.renameSession(session)} />
              <IconButton icon="folder" label={`Move ${title(session.title)} to project`} onClick={() => props.moveSession(session)} />
              <IconButton variant="danger" icon="trash" label={`Delete ${title(session.title)}`} onClick={() => props.deleteSession(session)} />
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

export function ProjectCollectionPage(props: {
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  projectID?: string
  openProject: (projectID: string) => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  openWorkbenchProject: (projectID: string, directory?: string) => void
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
    const attention = projects().reduce((count, project) => count + projectAttentionItems(project, props.snapshot, props.sessionOrderState).length, 0)
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

function ProjectsOverview(props: {
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
        <Button variant="primary" icon="plus" onClick={props.createProject}>Create project</Button>
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
            <TextInput value={props.query} placeholder="Search projects or folders" onInput={(event) => props.setQuery(event.currentTarget.value)} />
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
      <button class="project-directory-open" onClick={() => props.openProject(props.project.id)}>
        <span class="project-directory-icon"><Icon name="folder-open" /></span>
        <span>
          <strong>{projectLabel(props.project)}</strong>
          <small>{projectFolderPreview(props.project)}</small>
        </span>
      </button>
      <ProjectDirectoryMeta project={props.project} snapshot={props.snapshot} sessionOrderState={props.sessionOrderState} />
      <div class="project-directory-actions">
        <IconButton icon="arrowUp" label={`Move ${projectLabel(props.project)} up`} disabled={projectIndex(props.projects, props.project.id) <= 0} onClick={() => props.moveProject(props.project.id, -1)} />
        <IconButton icon="arrowDown" label={`Move ${projectLabel(props.project)} down`} disabled={projectIndex(props.projects, props.project.id) >= props.projects.length - 1} onClick={() => props.moveProject(props.project.id, 1)} />
        <Button size="sm" icon="session" onClick={() => props.createSession(props.project.id, props.project.folders[0]?.path)}>Session</Button>
        <IconButton icon="pencil" label={`Edit ${projectLabel(props.project)}`} onClick={() => props.editProject(props.project.id, projectLabel(props.project), props.project.folders.map((folder) => folder.path))} />
        <IconButton variant="danger" icon="trash" label={`Delete ${projectLabel(props.project)}`} onClick={() => props.deleteProject(props.project.id, projectLabel(props.project))} />
      </div>
    </article>
  )
}

function ProjectDirectoryMeta(props: { project: GuiSnapshot["projects"][number]; snapshot?: GuiSnapshot; sessionOrderState?: SessionOrderState }) {
  return (
    <div class="project-directory-meta">
      <span>{projectSessions(props.project, props.snapshot, props.sessionOrderState).length} sessions</span>
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

function ProjectCommandCenter(props: {
  project: GuiSnapshot["projects"][number]
  snapshot?: GuiSnapshot
  sessionOrderState?: SessionOrderState
  back: () => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  openSwarm: (swarmID: string) => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: (projectID: string) => void
  editProject: (projectID: string, currentName: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
  sessionPinned: (sessionID: string) => boolean
  toggleSessionPinned: (sessionID: string) => void
}) {
  const [sessionBucketsCollapsed, setSessionBucketsCollapsed] = createSignal<Record<string, boolean>>({ prior: true })
  const sessions = createMemo(() => projectSessions(props.project, props.snapshot, props.sessionOrderState))
  const attention = createMemo(() => projectAttentionItems(props.project, props.snapshot, props.sessionOrderState))
  const attentionSessionIDs = createMemo(() => new Set(attention().map((item) => item.sessionID)))
  const recentSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && (sessionOrderBucket(props.snapshot, session) !== "inactive" || isRecentSessionUpdate(session.time.updated))))
  const priorSessions = createMemo(() => sessions().filter((session) => !attentionSessionIDs().has(session.id) && sessionOrderBucket(props.snapshot, session) === "inactive" && !isRecentSessionUpdate(session.time.updated)))
  const swarms = createMemo(() => projectSwarms(props.project, props.snapshot))
  const views = createMemo(() => projectViews(props.project, props.snapshot))
  const primaryFolder = createMemo(() => props.project.folders[0]?.path)
  const toggleSessionBucket = (bucket: string) => setSessionBucketsCollapsed((value) => ({ ...value, [bucket]: !value[bucket] }))

  return (
    <div class="page project-command-page">
      <header class="project-home-header">
        <div>
          <Button size="sm" variant="ghost" icon="chevronLeft" onClick={props.back}>Projects</Button>
          <p class="eyebrow">Project home</p>
          <h1>{projectLabel(props.project)}</h1>
          <div class="project-home-folder-strip">
            <For each={props.project.folders} fallback={<span>No folders selected</span>}>
              {(folder) => <span title={folder.path}>{compactPath(folder.path)}</span>}
            </For>
            <button type="button" onClick={() => props.editProject(props.project.id, projectLabel(props.project), props.project.folders.map((folder) => folder.path))}>Edit project</button>
          </div>
        </div>
        <div class="project-home-actions">
          <Button variant="primary" icon="session" onClick={() => props.createSession(props.project.id, primaryFolder())}>New session</Button>
          <Button icon="swarm" onClick={() => props.createSwarm(props.project.id)}>Swarm</Button>
        </div>
      </header>

      <section class="project-home-layout project-home-layout-single">
        <div class="project-home-main">
          <ProjectHomePanel title="Attention" count={attention().length} empty="No sessions need your attention.">
            <For each={attention()}>
              {(item) => (
                <button class={`project-home-row ${projectAttentionRowClass(item)}`} onClick={() => props.openSession(item.sessionID)}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </button>
              )}
            </For>
          </ProjectHomePanel>

          <div class="dashboard-session-groups">
            <SessionCardBucket title="Recent Sessions" count={recentSessions().length} empty="No recent sessions." collapsed={!!sessionBucketsCollapsed().recent} onToggle={() => toggleSessionBucket("recent")}>
              <For each={recentSessions()}>
                {(session) => (
                  <SessionStatusCard
                    session={session}
                    snapshot={props.snapshot}
                    openSession={props.openSession}
                    pinned={props.sessionPinned(session.id)}
                    togglePinned={() => props.toggleSessionPinned(session.id)}
                  />
                )}
              </For>
            </SessionCardBucket>

            <SessionCardBucket title="Prior Sessions" count={priorSessions().length} empty="No prior sessions." collapsed={!!sessionBucketsCollapsed().prior} onToggle={() => toggleSessionBucket("prior")}>
              <For each={priorSessions()}>
                {(session) => (
                  <SessionStatusCard
                    session={session}
                    snapshot={props.snapshot}
                    openSession={props.openSession}
                    compact
                    pinned={props.sessionPinned(session.id)}
                    togglePinned={() => props.toggleSessionPinned(session.id)}
                  />
                )}
              </For>
            </SessionCardBucket>
          </div>

          <div class="project-home-split">
            <ProjectHomePanel title="Views" count={views().length} empty="No views include this project.">
              <For each={views().slice(0, 8)}>
                {(view) => (
                  <button class="project-home-row" onClick={() => props.openView(view.id)}>
                    <strong>{title(view.title)}</strong>
                    <span>{projectViewSessionCount(view)} sessions - {formatRelative(view.timeUpdated)}</span>
                  </button>
                )}
              </For>
            </ProjectHomePanel>

            <ProjectHomePanel title="Swarms" count={swarms().length} empty="No swarms for this project.">
              <For each={swarms().slice(0, 8)}>
                {(swarm) => (
                  <button class="project-home-row" onClick={() => props.openSwarm(swarm.id)}>
                    <strong>{title(swarm.title)}</strong>
                    <span>{swarm.roles.length} roles - {swarm.runs.length} runs</span>
                  </button>
                )}
              </For>
            </ProjectHomePanel>
          </div>
        </div>
      </section>
    </div>
  )
}

function ProjectHomePanel(props: { title: string; count: number; empty: string; children: JSX.Element }) {
  return (
    <section class="project-home-panel">
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
        <Button variant="primary" icon="plus" onClick={props.createProject}>Create project</Button>
      </Show>
    </div>
  )
}

function projectLabel(project: GuiSnapshot["projects"][number]) {
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

function projectAttentionRowClass(item: ReturnType<typeof projectAttentionItems>[number]) {
  if (item.detail === sessionStatusLabel("ready_for_review")) return "ready-for-review"
  if (item.detail === sessionStatusLabel("input_needed")) return "input-needed"
  if (item.tone === "danger") return "failed"
  if (item.tone === "info") return "in-progress"
  return "input-needed"
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
