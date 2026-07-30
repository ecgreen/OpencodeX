import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import { isRecentClientSessionUpdate } from "@opencode-ai/sdk/v2/session-order"
import { For, Show, createMemo } from "solid-js"
import { sessionOrderBucket } from "../lib/app-session-lists"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/session-api"
import { RailSection } from "./rail-section"
import { dropPlacement, sectionDrag } from "./rail-sidebar-drag"
import { SidebarSessionLink, SidebarTerminalSessionLink, SidebarViewLink } from "./rail-sidebar-links"
import type { RailDragTarget, RailDropTarget, RailSectionName } from "./rail-sidebar-types"
import { Button } from "./ui"

export function RailRecentSessionsSection(props: {
  sessions: Session[]
  terminalSessions: OpencodeXTerminalSession[]
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  activeTerminalSessionID: string
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  sessionPinned: (sessionID: string) => boolean
  toggle: () => void
  createSession: () => void
  openSession: (sessionID: string) => void
  openTerminalSession: (terminalSessionID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  renameTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  removeTerminalSession: (terminalSession: OpencodeXTerminalSession) => void
  terminalStatus: (terminalSession: OpencodeXTerminalSession) => string
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const recentSessions = createMemo(() => props.sessions.filter((session) => !props.sessionPinned(session.id) && (sessionOrderBucket(props.snapshot, session) !== "inactive" || isRecentClientSessionUpdate(session.time.updated))))
  const terminalSessions = createMemo(() => props.terminalSessions
    .filter((session) => !props.sessionPinned(session.id))
    .sort((a, b) => Number(b.timeUpdated) - Number(a.timeUpdated)))
  return (
    <RailSection
      title="Recent Sessions"
      count={recentSessions().length + terminalSessions().length}
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
            renameSession={() => props.renameSession(session)}
            deleteSession={() => props.deleteSession(session)}
          />
        )}
      </For>
      <For each={terminalSessions()}>
        {(session) => (
          <SidebarTerminalSessionLink
            terminalSession={session}
            status={props.terminalStatus(session)}
            active={props.activeTerminalSessionID === session.id}
            pinned={props.sessionPinned(session.id)}
            onClick={() => props.openTerminalSession(session.id)}
            togglePinned={() => props.toggleSessionPinned(session.id)}
            renameSession={() => props.renameTerminalSession(session)}
            removeSession={() => props.removeTerminalSession(session)}
          />
        )}
      </For>
    </RailSection>
  )
}

export function RailPriorSessionsSection(props: {
  sessions: Session[]
  snapshot?: GuiSnapshot
  collapsed: boolean
  activeSessionID: string
  createSession: () => void
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  sessionPinned: (sessionID: string) => boolean
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  toggle: () => void
  openSession: (sessionID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const priorSessions = createMemo(() => props.sessions.filter((session) => !props.sessionPinned(session.id) && sessionOrderBucket(props.snapshot, session) === "inactive" && !isRecentClientSessionUpdate(session.time.updated)))
  return (
    <RailSection
      title="Prior Sessions"
      count={priorSessions().length}
      collapsed={props.collapsed}
      toggle={props.toggle}
      action={props.createSession}
      drag={sectionDrag("prior", props)}
    >
      <For each={priorSessions()}>
        {(session) => (
          <SidebarSessionLink
            session={session}
            snapshot={props.snapshot}
            active={props.activeSessionID === session.id}
            pinned={props.sessionPinned(session.id)}
            onClick={() => props.openSession(session.id)}
            togglePinned={() => props.toggleSessionPinned(session.id)}
            renameSession={() => props.renameSession(session)}
            deleteSession={() => props.deleteSession(session)}
          />
        )}
      </For>
      <Show when={props.hasMore}>
        <Button appearance="ghost" class="rail-show-all" loading={props.loadingMore} onClick={props.loadMore}>
          Load more sessions
        </Button>
      </Show>
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
  editView: (viewID: string) => void
  deleteView: (viewID: string, name: string) => void
  openAllViews: () => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  dropView: (targetID: string, placement: "before" | "after") => void
  moveView: (viewID: string, offset: number) => void
  dropSection: (targetID: string, placement: "before" | "after") => void
  moveSection: (offset: number) => void
}) {
  const allViews = createMemo(() => props.snapshot?.views ?? [])
  const views = createMemo(() => allViews().slice(0, 8))
  return (
    <RailSection
      title="Views"
      count={allViews().length}
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
                editView={() => props.editView(view.id)}
                deleteView={() => props.deleteView(view.id, title(view.title))}
              />
            </div>
          </div>
        )}
      </For>
      <Show when={allViews().length > views().length}>
        <Button appearance="ghost" class="rail-show-all" onClick={props.openAllViews}>
          <span>Show all {allViews().length} views</span>
        </Button>
      </Show>
    </RailSection>
  )
}
