import type { Accessor, JSX } from "solid-js"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import { compactPath, formatRelative, title } from "../lib/format"
import {
  addPendingViewSessions,
  groupViewSessionsByProject,
  initialViewSelection,
  metadataWithPendingSessions,
  selectedPendingViewSessions,
  selectedViewSessionIDs,
  viewTitle,
  type ViewSelection,
} from "../lib/view-actions"
import type { GuiSnapshot } from "../lib/store"
import { type ViewItem } from "../lib/view-items"
import { moveRelative } from "../lib/reorder"
import {
  summarizeView,
  summarizeViews,
  viewProjectMeta,
  viewStatusMeta,
  type ViewSummary,
} from "../lib/view-summary"
import { sessionStatusLabel } from "../lib/session-status"
import { Icon } from "./icon"
import { PinButton } from "./pin-button"
import { Button, IconButton, TextInput } from "./ui"
import { ViewsPage } from "./views"

type ViewDragPreviewState = { id: string; x: number; y: number; width: number; height: number }
type ViewSummaryRowItem =
  | { type: "summary"; summary: ViewSummary }
  | { type: "placeholder"; id: string; height: number }

export function ViewsManagerPage(props: {
  view?: OpencodeXView
  views: OpencodeXView[]
  snapshot?: GuiSnapshot
  sessions: Session[]
  projects: GuiSnapshot["projects"]
  items: ViewItem[]
  renderItem: (item: Accessor<ViewItem>) => JSX.Element
  sidePanel?: JSX.Element
  sidePanelOpen?: boolean
  toggleSidePanel?: () => void
  openView: (viewID: string) => void
  createView: () => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, title: string) => void | Promise<void>
  moveView: (viewID: string, offset: number) => void | Promise<void>
  reorderViews: (viewIDs: string[]) => void | Promise<void>
  viewPinned: (viewID: string) => boolean
  toggleViewPinned: (viewID: string) => void
}) {
  const activeSummary = createMemo(() => props.view ? summarizeView({ view: props.view, snapshot: props.snapshot }) : undefined)
  return (
    <div class="page views-manager-page">
      <Show
        when={props.view}
        fallback={
          <ViewsMissionControl
            views={props.views}
            snapshot={props.snapshot}
            openView={props.openView}
            createView={props.createView}
            editView={props.editView}
            deleteView={props.deleteView}
            moveView={props.moveView}
            reorderViews={props.reorderViews}
            viewPinned={props.viewPinned}
            toggleViewPinned={props.toggleViewPinned}
          />
        }
      >
        {(view) => (
          <div class="views-manager-main">
            <div class="views-manager-content">
              <ActiveViewHeader
                title={view().title}
                summary={activeSummary()}
                sidePanelOpen={props.sidePanelOpen}
                toggleSidePanel={props.toggleSidePanel}
                edit={() => props.editView(view().id)}
                delete={() => props.deleteView(view().id, view().title)}
              />
              <ViewsPage view={view()} items={props.items} renderItem={props.renderItem} />
            </div>
            {props.sidePanel}
          </div>
        )}
      </Show>
    </div>
  )
}

function ViewsMissionControl(props: {
  views: OpencodeXView[]
  snapshot?: GuiSnapshot
  openView: (viewID: string) => void
  createView: () => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, title: string) => void | Promise<void>
  moveView: (viewID: string, offset: number) => void | Promise<void>
  reorderViews: (viewIDs: string[]) => void | Promise<void>
  viewPinned: (viewID: string) => boolean
  toggleViewPinned: (viewID: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const [movingView, setMovingView] = createSignal<{ id: string; direction: "up" | "down"; token: number }>()
  const [dragViewID, setDragViewID] = createSignal("")
  const [dropTarget, setDropTarget] = createSignal<{ id: string; placement: "before" | "after" }>()
  const [dragPreview, setDragPreview] = createSignal<ViewDragPreviewState>()
  const [dragPlaceholderHeight, setDragPlaceholderHeight] = createSignal(72)
  const [suppressedOpenViewID, setSuppressedOpenViewID] = createSignal("")
  const summaries = createMemo(() => summarizeViews({ views: props.views, snapshot: props.snapshot }))
  const filteredSummaries = createMemo(() => filterViewSummaries(summaries(), query()))
  const viewRows = createMemo<ViewSummaryRowItem[]>(() => {
    const items = filteredSummaries()
    const source = dragViewID()
    const target = dropTarget()
    if (!source) return items.map((summary) => ({ type: "summary", summary }))
    const byID = new Map(items.map((summary) => [summary.view.id, summary]))
    const ids = target ? moveRelative(items.map((summary) => summary.view.id), source, target.id, target.placement) : items.map((summary) => summary.view.id)
    return (ids.length === 0 ? items.map((summary) => summary.view.id) : ids).flatMap((id): ViewSummaryRowItem[] => {
      if (id === source) return [{ type: "placeholder", id: source, height: dragPlaceholderHeight() }]
      const summary = byID.get(id)
      return summary ? [{ type: "summary", summary }] : []
    })
  })
  const previewSummary = createMemo(() => summaries().find((summary) => summary.view.id === dragPreview()?.id))
  let viewRowRects = new Map<string, DOMRect>()
  let viewAnimationFrame = 0
  createEffect(() => {
    const signature = viewRows().map(viewSummaryRowKey).join("\n")
    const active = dragViewID() !== ""
    cancelAnimationFrame(viewAnimationFrame)
    viewAnimationFrame = requestAnimationFrame(() => {
      viewRowRects = animateViewSummaryRows(viewRowRects, active)
      void signature
    })
  })

  function moveView(viewID: string, offset: number) {
    setMovingView({ id: viewID, direction: offset < 0 ? "up" : "down", token: Date.now() })
    window.setTimeout(() => {
      setMovingView((current) => current?.id === viewID ? undefined : current)
    }, 360)
    return props.moveView(viewID, offset)
  }

  return (
    <>
      <ViewsIndexHeader createView={props.createView} query={query()} setQuery={setQuery} count={summaries().length} />
      <div class="views-index-layout">
        <section class="views-index-list" aria-label="Views">
          <header>
            <strong>All views</strong>
            <span>{filteredSummaries().length}{filteredSummaries().length === summaries().length ? "" : ` of ${summaries().length}`}</span>
          </header>
          <Show when={summaries().length > 0} fallback={<EmptyViewCreate onClick={props.createView} />}>
            <Show when={filteredSummaries().length > 0} fallback={<div class="empty">No views match this search.</div>}>
              <div class="view-summary-group-body">
                <For each={viewRows()}>
                  {(row) => row.type === "placeholder" ? (
                    <div
                      class="view-summary-drop-placeholder"
                      data-view-summary-layout-id="placeholder"
                      style={{ height: `${row.height}px` }}
                    />
                  ) : (
                    <ViewSummaryRow
                      summary={row.summary}
                      openView={(viewID) => {
                        if (suppressedOpenViewID() === viewID) return
                        props.openView(viewID)
                      }}
                      editView={props.editView}
                      deleteView={props.deleteView}
                      moveView={moveView}
                      pinned={props.viewPinned(row.summary.view.id)}
                      togglePinned={() => props.toggleViewPinned(row.summary.view.id)}
                      moving={movingView()?.id === row.summary.view.id ? movingView()?.direction : undefined}
                      dragging={dragViewID() === row.summary.view.id}
                      dropping={dropTarget()?.id === row.summary.view.id ? dropTarget()?.placement : undefined}
                      startPointerDrag={(event) => startViewPointerDrag(event, row.summary.view.id)}
                      index={summaries().findIndex((item) => item.view.id === row.summary.view.id)}
                      total={summaries().length}
                    />
                  )}
                </For>
                <ViewDragPreview preview={dragPreview()} summary={previewSummary()} />
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </>
  )

  function startViewPointerDrag(event: PointerEvent & { currentTarget: HTMLElement }, sourceID: string) {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(".view-summary-actions")) return
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
      setDragViewID(sourceID)
      setDragPlaceholderHeight(rect.height)
      setDragPreview({
        id: sourceID,
        x: moveEvent.clientX - offset.x,
        y: moveEvent.clientY - offset.y,
        width: rect.width,
        height: rect.height,
      })
      const nextTarget = viewDropTargetFromPointer(sourceID, moveEvent.clientY)
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
      setSuppressedOpenViewID(sourceID)
      window.setTimeout(() => setSuppressedOpenViewID((current) => current === sourceID ? "" : current), 250)
      setDragViewID("")
      setDropTarget(undefined)
      setDragPreview(undefined)
      if (!target) return
      const ids = summaries().map((summary) => summary.view.id)
      const ordered = moveRelative(ids, sourceID, target.id, target.placement)
      if (ordered.length === 0) return
      const sourceIndex = ids.indexOf(sourceID)
      const targetIndex = ordered.indexOf(sourceID)
      setMovingView({ id: sourceID, direction: targetIndex < sourceIndex ? "up" : "down", token: Date.now() })
      window.setTimeout(() => {
        setMovingView((current) => current?.id === sourceID ? undefined : current)
      }, 360)
      void props.reorderViews(ordered)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      setDragViewID("")
      setDropTarget(undefined)
      setDragPreview(undefined)
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }
}

function ViewsIndexHeader(props: { createView: () => void; query: string; setQuery: (value: string) => void; count: number }) {
  return (
    <header class="views-index-header">
      <div>
        <p class="eyebrow">Views</p>
        <h1>Views</h1>
        <p>{props.count} saved multi-session {props.count === 1 ? "view" : "views"}</p>
      </div>
      <div class="views-index-controls">
        <TextInput value={props.query} onInput={(event) => props.setQuery(event.currentTarget.value)} placeholder="Search views or sessions" />
        <Button class="manager-create-button" variant="primary" icon="plus" onClick={props.createView}>Create view</Button>
      </div>
    </header>
  )
}

function EmptyViewCreate(props: { onClick: () => void }) {
  return <button class="dashboard-item-card empty-create interactive" onClick={props.onClick}><strong>+ Create view</strong><span>Choose sessions once, then reopen them together.</span><small>create</small></button>
}

function ViewSummaryRow(props: {
  summary: ViewSummary
  openView: (viewID: string) => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, title: string) => void | Promise<void>
  moveView: (viewID: string, offset: number) => void | Promise<void>
  pinned: boolean
  togglePinned: () => void
  moving?: "up" | "down"
  dragging: boolean
  dropping?: "before" | "after"
  startPointerDrag: (event: PointerEvent & { currentTarget: HTMLElement }) => void
  index: number
  total: number
}) {
  return (
    <article
      class="view-summary-row dashboard-status-card interactive"
      classList={{
        [`status-${props.summary.status.replaceAll("_", "-")}`]: true,
        "moving-up": props.moving === "up",
        "moving-down": props.moving === "down",
        dragging: props.dragging,
        dropping: props.dropping !== undefined,
        "drop-after": props.dropping === "after",
      }}
      data-view-summary-row-id={props.summary.view.id}
      data-view-summary-layout-id={props.summary.view.id}
      onPointerDown={props.startPointerDrag}
    >
      <button class="view-summary-main" onClick={() => props.openView(props.summary.view.id)}>
        <span class="view-status-dot" aria-label={sessionStatusLabel(props.summary.status)} />
        <span>
          <strong>{title(props.summary.view.title)}</strong>
          <small>{props.summary.paneCount} panes - {viewProjectMeta(props.summary)} - {formatRelative(props.summary.lastUpdated)}</small>
        </span>
        <span class="view-summary-signal">{viewStatusMeta(props.summary)}</span>
      </button>
      <div class="view-summary-actions">
        <PinButton pinned={props.pinned} label={title(props.summary.view.title)} onClick={props.togglePinned} />
        <IconButton icon="pencil" label="Edit view" onClick={() => props.editView(props.summary.view.id)} />
        <IconButton icon="arrowUp" label="Move view up" disabled={props.index === 0} onClick={() => props.moveView(props.summary.view.id, -1)} />
        <IconButton icon="arrowDown" label="Move view down" disabled={props.index === props.total - 1} onClick={() => props.moveView(props.summary.view.id, 1)} />
        <IconButton variant="danger" icon="trash" label="Delete view" onClick={() => props.deleteView(props.summary.view.id, props.summary.view.title)} />
      </div>
      <Show when={props.summary.sessionRows.length > 0 || props.summary.pendingCount > 0}>
        <p class="view-summary-session-line">{viewSessionPreview(props.summary)}</p>
      </Show>
    </article>
  )
}

function ViewDragPreview(props: { preview?: ViewDragPreviewState; summary?: ViewSummary }) {
  return (
    <Show when={props.preview && props.summary}>
      <Portal>
        <div
          class="view-summary-drag-preview"
          style={{ left: `${props.preview?.x ?? 0}px`, top: `${props.preview?.y ?? 0}px`, width: `${props.preview?.width ?? 320}px` }}
        >
          <div class="view-summary-drag-preview-main">
            <span class="view-status-dot" />
            <span>
              <strong>{title(props.summary?.view.title)}</strong>
              <small>{props.summary?.paneCount} panes - {props.summary ? viewProjectMeta(props.summary) : ""}</small>
            </span>
            <span>{props.summary ? viewStatusMeta(props.summary) : ""}</span>
          </div>
          <Show when={props.summary ? viewSessionPreview(props.summary) : ""}>
            {(preview) => <p>{preview()}</p>}
          </Show>
        </div>
      </Portal>
    </Show>
  )
}

export function ViewEditorPage(props: {
  view?: OpencodeXView
  sessions: Session[]
  projects: GuiSnapshot["projects"]
  save: (input: { viewID?: string; title: string; sessionIDs: string[]; metadata?: Record<string, unknown> }) => void | Promise<void>
  cancel: () => void
}) {
  const [viewName, setViewName] = createSignal(props.view?.title ?? "")
  const [selection, setSelection] = createSignal<ViewSelection[]>(initialViewSelection(props.view))
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [sessionQuery, setSessionQuery] = createSignal("")
  const selectedIDs = createMemo(() => new Set(selectedViewSessionIDs(selection())))
  const pending = createMemo(() => selectedPendingViewSessions(selection()))
  const editing = createMemo(() => props.view !== undefined)
  const [collapsedSessionGroups, setCollapsedSessionGroups] = createSignal<Record<string, boolean>>({})
  const groupedSessions = createMemo(() => groupViewSessionsByProject({ sessions: props.sessions, projects: props.projects }))
  const filteredGroups = createMemo(() => filterSessionGroups(groupedSessions(), sessionQuery()))
  const hasAvailableSessions = createMemo(() => filteredGroups().projects.length > 0 || filteredGroups().unprojected.length > 0)
  const selectedPanes = createMemo(() => selection().map((item) => ({
    item,
    session: item.kind === "existing" ? props.sessions.find((session) => session.id === item.sessionID) : undefined,
  })))

  function toggleSession(sessionID: string) {
    setError("")
    if (selectedIDs().has(sessionID)) {
      setSelection((current) => current.filter((item) => item.kind !== "existing" || item.sessionID !== sessionID))
      return
    }
    if (selection().length >= 8) {
      setError("A view can include at most eight panes.")
      return
    }
    setSelection((current) => [...current, { kind: "existing", sessionID }])
  }

  function addPending(projectID?: string) {
    setError("")
    if (selection().length >= 8) {
      setError("A view can include at most eight panes.")
      return
    }
    const project = props.projects.find((item) => item.id === projectID)
    setSelection((current) => addPendingViewSessions({
      selection: current,
      count: 1,
      projectID: project?.id,
      projectLabel: project ? title(project.name ?? project.project.name) : undefined,
      directory: project?.folders[0]?.path,
    }))
  }

  function removePending(slotID: string) {
    setSelection((current) => current.filter((item) => item.kind !== "pending" || item.slot.id !== slotID))
  }

  function removeExisting(sessionID: string) {
    setSelection((current) => current.filter((item) => item.kind !== "existing" || item.sessionID !== sessionID))
  }

  function toggleSessionGroup(groupID: string) {
    setCollapsedSessionGroups((current) => ({ ...current, [groupID]: !current[groupID] }))
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    setError("")
    if (selection().length === 0) {
      setError("Select at least one session or pending pane.")
      return
    }
    setSaving(true)
    try {
      await props.save({
        viewID: props.view?.id,
        title: viewTitle({ title: viewName(), selection: selection(), sessions: props.sessions }),
        sessionIDs: selectedViewSessionIDs(selection()),
        metadata: metadataWithPendingSessions(props.view?.metadata, pending()),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="page view-editor-page" onSubmit={save}>
      <header class="view-editor-header">
        <div>
          <p class="eyebrow">{editing() ? "Edit view" : "Create view"}</p>
          <h1>{editing() ? props.view?.title ?? "Edit view" : "Create view"}</h1>
        </div>
        <div class="row-actions">
          <Button icon="x" onClick={props.cancel}>Cancel</Button>
        </div>
      </header>
      <div class="view-editor-layout">
        <aside class="view-builder-panel">
          <label class="full-width-field">
            <span>Title</span>
            <TextInput value={viewName()} onInput={(event) => setViewName(event.currentTarget.value)} placeholder="Generated from selected sessions" />
          </label>
          <section class="selected-pane-list">
            <header>
              <strong>Selected panes</strong>
              <span>{selection().length}/8</span>
            </header>
            <For each={selectedPanes()} fallback={<div class="empty">Select sessions from the list.</div>}>
              {(pane, index) => (
                <article class="selected-pane-row">
                  <span>{index() + 1}</span>
                  <div>
                    <strong>{pane.item.kind === "existing" ? title(pane.session?.title) : "New session"}</strong>
                    <small>{pane.item.kind === "existing" ? compactPath(pane.session?.directory) : pane.item.slot.projectLabel ?? "No project"}</small>
                  </div>
                  <IconButton
                    variant="danger"
                    icon="trash"
                    label="Remove pane"
                    onClick={() => pane.item.kind === "existing" ? removeExisting(pane.item.sessionID) : removePending(pane.item.slot.id)}
                  />
                </article>
              )}
            </For>
          </section>
          <section class="pending-pane-actions">
            <header><strong>Add a new session pane</strong></header>
            <div class="row-actions">
              <Button size="sm" icon="plus" onClick={() => addPending()}><span class="pending-pane-button-label">No project</span></Button>
              <For each={props.projects.slice(0, 3)}>
                {(project) => <Button size="sm" icon="plus" onClick={() => addPending(project.id)}><span class="pending-pane-button-label">{title(project.name ?? project.project.name)}</span></Button>}
              </For>
            </div>
          </section>
          <section class="view-editor-submit-panel">
            <Show when={error()}>
              <div class="notice error">{error()}</div>
            </Show>
            <Button type="submit" variant="primary" icon="check" disabled={saving()}>
              {saving() ? "Saving..." : editing() ? "Save view" : "Create view"}
            </Button>
          </section>
        </aside>
        <section class="view-session-picker">
          <header>
            <div>
              <strong>Available sessions</strong>
              <span>{selectedIDs().size} selected</span>
            </div>
            <TextInput value={sessionQuery()} onInput={(event) => setSessionQuery(event.currentTarget.value)} placeholder="Search sessions" />
          </header>
          <Show when={hasAvailableSessions()} fallback={<div class="empty">No sessions available.</div>}>
            <div class="view-session-groups">
              <For each={filteredGroups().projects}>
                {(group) => {
                  const groupID = () => `project:${group.project.id}`
                  return (
                    <ViewSessionGroup
                      id={groupID()}
                      title={title(group.project.name ?? group.project.project.name)}
                      count={group.sessions.length}
                      collapsed={collapsedSessionGroups()[groupID()]}
                      toggle={toggleSessionGroup}
                    >
                      <ViewSessionGrid sessions={group.sessions} selectedIDs={selectedIDs()} toggleSession={toggleSession} />
                    </ViewSessionGroup>
                  )
                }}
              </For>
              <Show when={filteredGroups().unprojected.length > 0}>
                <ViewSessionGroup
                  id="unprojected"
                  title="No Project"
                  count={filteredGroups().unprojected.length}
                  collapsed={collapsedSessionGroups().unprojected}
                  toggle={toggleSessionGroup}
                >
                  <ViewSessionGrid sessions={filteredGroups().unprojected} selectedIDs={selectedIDs()} toggleSession={toggleSession} />
                </ViewSessionGroup>
              </Show>
            </div>
          </Show>
        </section>
      </div>
    </form>
  )
}

function filterViewSummaries(summaries: ViewSummary[], query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return summaries
  return summaries.filter((summary) => [
    summary.view.title,
    viewProjectMeta(summary),
    viewStatusMeta(summary),
    ...summary.sessionRows.map((row) => row.session.title),
    ...summary.projectLabels,
  ].some((item) => item.toLowerCase().includes(value)))
}

function viewSessionPreview(summary: ViewSummary) {
  return [
    summary.sessionRows.slice(0, 3).map((row) => title(row.session.title)).join(", "),
    summary.sessionRows.length > 3 ? `${summary.sessionRows.length - 3} more` : "",
    summary.pendingCount > 0 ? `${summary.pendingCount} pending` : "",
  ].filter(Boolean).join(" - ")
}

function viewSummaryRowKey(row: ViewSummaryRowItem) {
  return row.type === "summary" ? row.summary.view.id : `placeholder:${row.id}:${row.height}`
}

function animateViewSummaryRows(previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>("[data-view-summary-layout-id]")) {
    const key = element.dataset.viewSummaryLayoutId
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

function viewDropTargetFromPointer(sourceID: string, clientY: number) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-view-summary-row-id]"))
    .filter((element) => element.dataset.viewSummaryRowId !== sourceID)
  const before = rows.find((element) => {
    const rect = element.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2
  })
  if (before?.dataset.viewSummaryRowId) return { id: before.dataset.viewSummaryRowId, placement: "before" as const }
  const after = rows.at(-1)?.dataset.viewSummaryRowId
  return after ? { id: after, placement: "after" as const } : undefined
}

function filterSessionGroups(grouped: ReturnType<typeof groupViewSessionsByProject>, query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return grouped
  return {
    projects: grouped.projects
      .map((group) => ({ ...group, sessions: group.sessions.filter((session) => sessionMatchesQuery(session, value)) }))
      .filter((group) => group.sessions.length > 0),
    unprojected: grouped.unprojected.filter((session) => sessionMatchesQuery(session, value)),
  }
}

function sessionMatchesQuery(session: Session, query: string) {
  return [
    session.title,
    session.directory,
    session.id,
  ].some((item) => (item ?? "").toLowerCase().includes(query))
}

function ViewSessionGroup(props: {
  id: string
  title: string
  count: number
  collapsed?: boolean
  toggle: (id: string) => void
  children: JSX.Element
}) {
  return (
    <section class="view-session-group">
      <button type="button" class="view-session-group-header" aria-expanded={!props.collapsed} onClick={() => props.toggle(props.id)}>
        <span>
          <Icon name={props.collapsed ? "chevronRight" : "chevronDown"} />
          <strong>{props.title}</strong>
        </span>
        <small>{props.count} {props.count === 1 ? "session" : "sessions"}</small>
      </button>
      <div class="view-session-group-content" classList={{ collapsed: !!props.collapsed }}>
        <div>{props.children}</div>
      </div>
    </section>
  )
}

function ViewSessionGrid(props: {
  sessions: Session[]
  selectedIDs: Set<string>
  toggleSession: (sessionID: string) => void
}) {
  return (
    <div class="view-session-grid">
      <For each={props.sessions}>
        {(session) => (
          <label class="view-session-card view-session-row">
            <input type="checkbox" checked={props.selectedIDs.has(session.id)} onChange={() => props.toggleSession(session.id)} />
            <span class="view-session-card-copy">
              <strong>{title(session.title)}</strong>
              <small>{compactPath(session.directory)} - {formatRelative(session.time.updated)}</small>
            </span>
            <Show when={props.selectedIDs.has(session.id)}>
              <small class="view-session-selected">selected</small>
            </Show>
          </label>
        )}
      </For>
    </div>
  )
}

function ManagerHeader(props: {
  eyebrow: string
  title: string
  description: string
  actions: Array<{ label: string; icon: string; danger?: boolean; primary?: boolean; onClick: () => void | Promise<void> }>
}) {
  return (
    <header class="manager-page-header">
      <div>
        <p class="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      <div class="row-actions">
        <For each={props.actions}>
          {(action) => <Button class={action.primary ? "manager-create-button" : undefined} variant={action.danger ? "danger" : action.primary ? "primary" : "secondary"} icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
        </For>
      </div>
    </header>
  )
}

function ActiveViewHeader(props: {
  title: string
  summary?: ViewSummary
  sidePanelOpen?: boolean
  toggleSidePanel?: () => void
  edit: () => void | Promise<void>
  delete: () => void | Promise<void>
}) {
  return (
    <header class="active-view-header">
      <div>
        <h1>{props.title}</h1>
        <Show when={props.summary}>
          {(summary) => <span>{summary().paneCount} panes - {viewStatusMeta(summary())}</span>}
        </Show>
      </div>
      <div class="active-view-actions">
        <Show when={props.toggleSidePanel}>
          {(toggleSidePanel) => (
            <IconButton
              icon="panel"
              label={props.sidePanelOpen ? "Close side panel" : "Open side panel"}
              pressed={props.sidePanelOpen}
              onClick={toggleSidePanel()}
            />
          )}
        </Show>
        <IconButton icon="pencil" label="Edit view" onClick={props.edit} />
        <IconButton variant="danger" icon="trash" label="Delete view" onClick={props.delete} />
      </div>
    </header>
  )
}
