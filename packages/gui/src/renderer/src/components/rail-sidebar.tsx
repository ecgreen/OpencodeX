import type { Session } from "@opencode-ai/sdk/v2/client"
import { Mark } from "@opencode-ai/ui/logo"
import { For, Show } from "solid-js"
import { title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { RailProjectsSection, RailRecentSessionsSection, RailViewsSection } from "./rail-sidebar-sections"
import type { RailDragTarget, RailNavItem, RailRouteName, RailSectionName } from "./rail-sidebar-types"

export type { RailDragTarget, RailNavItem, RailRouteName, RailSectionName } from "./rail-sidebar-types"

export function RailSidebar(props: {
  snapshot?: GuiSnapshot
  sessions: Session[]
  navItems: readonly RailNavItem[]
  activeRouteName: string
  activeSessionID: string
  activeViewID?: string
  railCollapsed: boolean
  railSections: Record<RailSectionName, boolean>
  dragTarget?: RailDragTarget
  projectSessions: (project: GuiSnapshot["projects"][number]) => Session[]
  projectExpanded: (projectID: string) => boolean
  toggleRail: () => void
  toggleRailSection: (name: RailSectionName) => void
  toggleProject: (projectID: string) => void
  openDashboard: () => void
  openRoute: (name: RailRouteName) => void
  openSession: (sessionID: string) => void
  openView: (viewID: string) => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createView: () => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  dropProject: (targetID: string, placement: "before" | "after") => void
  dropView: (targetID: string, placement: "before" | "after") => void
  moveProject: (projectID: string, offset: number) => void
  moveView: (viewID: string, offset: number) => void
}) {
  return (
    <aside class="rail" aria-label="OpencodeX navigation">
      <RailBrand
        snapshot={props.snapshot}
        railCollapsed={props.railCollapsed}
        openDashboard={props.openDashboard}
        toggleRail={props.toggleRail}
        createSession={() => props.createSession()}
      />
      <Show when={!props.railCollapsed}>
        <RailNav items={props.navItems} activeRouteName={props.activeRouteName} openRoute={props.openRoute} />
      </Show>
      <div class="rail-scroll">
        <RailProjectsSection
          snapshot={props.snapshot}
          collapsed={props.railSections.projects}
          activeSessionID={props.activeSessionID}
          dragTarget={props.dragTarget}
          projectSessions={props.projectSessions}
          projectExpanded={props.projectExpanded}
          toggle={() => props.toggleRailSection("projects")}
          toggleProject={props.toggleProject}
          createProject={props.createProject}
          createSession={props.createSession}
          openSession={props.openSession}
          startDrag={props.startDrag}
          clearDragTarget={props.clearDragTarget}
          dropProject={props.dropProject}
          moveProject={props.moveProject}
        />
        <RailRecentSessionsSection
          sessions={props.sessions}
          snapshot={props.snapshot}
          collapsed={props.railSections.recent}
          activeSessionID={props.activeSessionID}
          toggle={() => props.toggleRailSection("recent")}
          createSession={() => props.createSession()}
          openSession={props.openSession}
        />
        <RailViewsSection
          snapshot={props.snapshot}
          collapsed={props.railSections.views}
          active={props.activeRouteName === "views"}
          activeViewID={props.activeViewID}
          dragTarget={props.dragTarget}
          toggle={() => props.toggleRailSection("views")}
          createView={props.createView}
          openView={props.openView}
          startDrag={props.startDrag}
          clearDragTarget={props.clearDragTarget}
          dropView={props.dropView}
          moveView={props.moveView}
        />
      </div>
    </aside>
  )
}

function RailBrand(props: {
  snapshot?: GuiSnapshot
  railCollapsed: boolean
  openDashboard: () => void
  toggleRail: () => void
  createSession: () => void
}) {
  return (
    <div class="brand" onClick={props.openDashboard}>
      <span class="brand-mark"><Mark /></span>
      <div class="brand-copy">
        <strong>OpencodeX</strong>
        <span>{props.snapshot?.projects[0] ? title(props.snapshot.projects[0].name ?? props.snapshot.projects[0].project.name) : "Command center"}</span>
      </div>
      <div class="brand-actions">
        <button
          class="rail-toggle"
          title={`${props.railCollapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
          aria-label="Toggle sidebar"
          aria-expanded={!props.railCollapsed}
          onClick={(event) => {
            event.stopPropagation()
            props.toggleRail()
          }}
        ><Icon name="panel" /></button>
        <Show when={props.railCollapsed}>
          <button
            class="new-button"
            title="New session (Ctrl+N)"
            aria-label="New session"
            onClick={(event) => {
              event.stopPropagation()
              props.createSession()
            }}
          ><Icon name="plus" /></button>
        </Show>
      </div>
    </div>
  )
}

function RailNav(props: {
  items: readonly RailNavItem[]
  activeRouteName: string
  openRoute: (name: RailRouteName) => void
}) {
  return (
    <nav class="nav">
      <For each={props.items}>
        {(item) => (
          <button aria-label={`${item.label}: ${item.description}`} title={`${item.label}: ${item.description} (${item.shortcut})`} classList={{ active: props.activeRouteName === item.name }} onClick={() => props.openRoute(item.name)}>
            <Icon name={item.icon} />
            <span class="nav-label">{item.label}</span>
            <small>{item.shortcut}</small>
          </button>
        )}
      </For>
    </nav>
  )
}
