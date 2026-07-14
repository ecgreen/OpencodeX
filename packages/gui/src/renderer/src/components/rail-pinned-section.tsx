import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, createMemo } from "solid-js"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { RailSection } from "./rail-section"
import { sectionDrag } from "./rail-sidebar-drag"
import { SidebarSessionLink, SidebarViewLink } from "./rail-sidebar-links"
import type { RailDragTarget, RailDropTarget, RailSectionName } from "./rail-sidebar-types"

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
  createSession: () => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  toggleSessionPinned: (sessionID: string) => void
  toggleViewPinned: (viewID: string) => void
  renameSession: (session: Session) => void
  deleteSession: (session: Session) => void
  editView: (viewID: string) => void
  deleteView: (viewID: string, name: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
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
      action={props.createSession}
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
            renameSession={() => props.renameSession(session)}
            deleteSession={() => props.deleteSession(session)}
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
            editView={() => props.editView(view.id)}
            deleteView={() => props.deleteView(view.id, title(view.title))}
          />
        )}
      </For>
    </RailSection>
  )
}
