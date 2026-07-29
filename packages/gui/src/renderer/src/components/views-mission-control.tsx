import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { formatRelative, title } from "../lib/format"
import { moveRelative } from "../lib/reorder"
import { sessionStatusLabel } from "../lib/session-status"
import type { GuiSnapshot } from "../lib/session-api"
import {
  summarizeViews,
  viewProjectMeta,
  viewStatusMeta,
  type ViewSummary,
} from "../lib/view-summary"
import { PinButton } from "./pin-button"
import { Button, IconButton, SearchField } from "./ui"

type ViewDragPreviewState = { id: string; x: number; y: number; width: number; height: number }
type ViewSummaryRowItem =
  | { type: "summary"; summary: ViewSummary }
  | { type: "placeholder"; id: string; height: number }

export function ViewsMissionControl(props: {
  views: ClientCatalogView[]
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
  const summaryIndexes = createMemo(() => new Map(summaries().map((summary, index) => [summary.view.id, index])))
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
  const pointerDragCleanups = new Set<() => void>()
  const timers = new Set<number>()
  let viewRowRects = new Map<string, DOMRect>()

  onCleanup(() => {
    pointerDragCleanups.forEach((cleanup) => cleanup())
    timers.forEach((timer) => window.clearTimeout(timer))
  })

  createEffect(() => {
    const signature = viewRows().map(viewSummaryRowKey).join("\n")
    const active = dragViewID() !== ""
    const frame = requestAnimationFrame(() => {
      viewRowRects = animateViewSummaryRows(viewRowRects, active)
      void signature
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })

  function schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      callback()
    }, delay)
    timers.add(timer)
  }

  function moveView(viewID: string, offset: number) {
    setMovingView({ id: viewID, direction: offset < 0 ? "up" : "down", token: Date.now() })
    schedule(() => {
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
                      index={summaryIndexes().get(row.summary.view.id) ?? -1}
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
      setSuppressedOpenViewID(sourceID)
      schedule(() => setSuppressedOpenViewID((current) => current === sourceID ? "" : current), 250)
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
      schedule(() => {
        setMovingView((current) => current?.id === sourceID ? undefined : current)
      }, 360)
      void props.reorderViews(ordered)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      cleanup()
      setDragViewID("")
      setDropTarget(undefined)
      setDragPreview(undefined)
    }

    pointerDragCleanups.add(cleanup)
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
        <SearchField aria-label="Search views" value={props.query} onInput={(event) => props.setQuery(event.currentTarget.value)} placeholder="Search views or sessions" clearable={props.query.length > 0} onClear={() => props.setQuery("")} />
        <Button class="manager-create-button" appearance="solid" tone="accent" icon="plus" onClick={props.createView}>Create view</Button>
      </div>
    </header>
  )
}

function EmptyViewCreate(props: { onClick: () => void }) {
  return <Button appearance="ghost" class="dashboard-item-card empty-create interactive" onClick={props.onClick}><strong>+ Create view</strong><span>Choose sessions once, then reopen them together.</span><small>create</small></Button>
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
      <Button appearance="ghost" class="view-summary-main" onClick={() => props.openView(props.summary.view.id)}>
        <span class="view-status-dot" aria-label={sessionStatusLabel(props.summary.status)} />
        <span>
          <strong>{title(props.summary.view.title)}</strong>
          <small>{props.summary.paneCount} panes - {viewProjectMeta(props.summary)} - {formatRelative(props.summary.lastUpdated)}</small>
        </span>
        <span class="view-summary-signal">{viewStatusMeta(props.summary)}</span>
      </Button>
      <div class="view-summary-actions">
        <PinButton pinned={props.pinned} label={title(props.summary.view.title)} onClick={props.togglePinned} />
        <IconButton icon="pencil" label="Edit view" onClick={() => props.editView(props.summary.view.id)} />
        <IconButton icon="arrowUp" label="Move view up" disabled={props.index === 0} onClick={() => props.moveView(props.summary.view.id, -1)} />
        <IconButton icon="arrowDown" label="Move view down" disabled={props.index === props.total - 1} onClick={() => props.moveView(props.summary.view.id, 1)} />
        <IconButton appearance="ghost" tone="danger" icon="trash" label="Delete view" onClick={() => props.deleteView(props.summary.view.id, props.summary.view.title)} />
      </div>
      <Show when={props.summary.sessionRows.length > 0 || props.summary.pendingCount > 0}>
        <p class="view-summary-session-line">{viewSessionPreview(props.summary)}</p>
      </Show>
      <Show when={props.summary.status === "ready_for_review"}>
        <span class="status-glyph" aria-label={sessionStatusLabel(props.summary.status)} />
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
