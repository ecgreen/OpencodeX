import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import type { Accessor, JSX } from "solid-js"
import { Show, createMemo } from "solid-js"
import type { GuiSnapshot } from "../lib/session-api"
import type { ViewItem } from "../lib/view-items"
import { summarizeView, viewStatusMeta, type ViewSummary } from "../lib/view-summary"
import { IconButton } from "./ui"
import { ViewsMissionControl } from "./views-mission-control"
import { ViewsPage } from "./views"

export { ViewEditorPage } from "./view-editor-page"

export function ViewsManagerPage(props: {
  view?: ClientCatalogView
  views: ClientCatalogView[]
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
  /** The view's panes put away so the workspace has the whole window. */
  centerCollapsed?: boolean
}) {
  const activeSummary = createMemo(() => props.view ? summarizeView({ view: props.view, snapshot: props.snapshot }) : undefined)
  return (
    <div
      class="page views-manager-page"
      classList={{ "has-active-view": Boolean(props.view) }}
      data-center-collapsed={props.centerCollapsed ? "" : undefined}
    >
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
        <IconButton appearance="ghost" tone="danger" icon="trash" label="Delete view" onClick={props.delete} />
      </div>
    </header>
  )
}
