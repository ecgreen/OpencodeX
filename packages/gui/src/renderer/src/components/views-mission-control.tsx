import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { For, Show, createMemo, createSignal } from "solid-js"
import { Portal } from "solid-js/web"
import { formatRelative, title } from "../lib/format"
import { createPointerReorder, type PointerReorderPreview } from "../lib/pointer-reorder"
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
  const summaries = createMemo(() => summarizeViews({ views: props.views, snapshot: props.snapshot }))
  const summaryIndexes = createMemo(() => new Map(summaries().map((summary, index) => [summary.view.id, index])))
  const filteredSummaries = createMemo(() => filterViewSummaries(summaries(), query()))
  const reorder = createPointerReorder<ViewSummary>({
    items: filteredSummaries,
    getID: (summary) => summary.view.id,
    rowAttribute: "data-view-summary-row-id",
    layoutAttribute: "data-view-summary-layout-id",
    ignoreSelector: ".view-summary-actions",
    onReorder: (sourceID, target) => {
      const ids = summaries().map((summary) => summary.view.id)
      const ordered = moveRelative(ids, sourceID, target.id, target.placement)
      if (ordered.length > 0) void props.reorderViews(ordered)
    },
  })

  function moveView(viewID: string, offset: number) {
    reorder.markMoved(viewID, offset < 0 ? "up" : "down")
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
                <For each={reorder.rows()}>
                  {(row) => row.type === "placeholder" ? (
                    <div
                      class="view-summary-drop-placeholder"
                      data-view-summary-layout-id="placeholder"
                      style={{ height: `${row.height}px` }}
                    />
                  ) : (
                    <ViewSummaryRow
                      summary={row.item}
                      openView={(viewID) => {
                        if (reorder.suppressed(viewID)) return
                        props.openView(viewID)
                      }}
                      editView={props.editView}
                      deleteView={props.deleteView}
                      moveView={moveView}
                      pinned={props.viewPinned(row.id)}
                      togglePinned={() => props.toggleViewPinned(row.id)}
                      moving={reorder.moving(row.id)}
                      dragging={reorder.dragging(row.id)}
                      dropping={reorder.dropping(row.id)}
                      startPointerDrag={(event) => reorder.startDrag(event, row.id)}
                      index={summaryIndexes().get(row.id) ?? -1}
                      total={summaries().length}
                    />
                  )}
                </For>
                <ViewDragPreview preview={reorder.preview()} summary={reorder.previewItem()} />
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </>
  )

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

function ViewDragPreview(props: { preview?: PointerReorderPreview; summary?: ViewSummary }) {
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
