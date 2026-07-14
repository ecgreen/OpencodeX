import type { Session } from "@opencode-ai/sdk/v2/client"
import { isRecentClientSessionUpdate } from "@opencode-ai/sdk/v2/session-order"
import { For, createMemo } from "solid-js"
import { sessionOrderBucket } from "../lib/app-session-lists"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { RailSection } from "./rail-section"
import { dropPlacement, sectionDrag } from "./rail-sidebar-drag"
import { SidebarSessionLink, SidebarViewLink } from "./rail-sidebar-links"
import type { RailDragTarget, RailDropTarget, RailSectionName } from "./rail-sidebar-types"

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
  const recentSessions = createMemo(() => props.sessions.filter((session) => !props.sessionPinned(session.id) && (sessionOrderBucket(props.snapshot, session) !== "inactive" || isRecentClientSessionUpdate(session.time.updated))))
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
            renameSession={() => props.renameSession(session)}
            deleteSession={() => props.deleteSession(session)}
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
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  sessionPinned: (sessionID: string) => boolean
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
                editView={() => props.editView(view.id)}
                deleteView={() => props.deleteView(view.id, title(view.title))}
              />
            </div>
          </div>
        )}
      </For>
    </RailSection>
  )
}
