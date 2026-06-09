import type { Session } from "@opencode-ai/sdk/v2/client"
import { Mark } from "@opencode-ai/ui/logo"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { title } from "../lib/format"
import { moveRelative } from "../lib/reorder"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { RailPinnedSection, RailProjectsSection, RailRecentSessionsSection, RailViewsSection } from "./rail-sidebar-sections"
import type { RailDragTarget, RailDropTarget, RailNavItem, RailRouteName, RailSectionName } from "./rail-sidebar-types"

export type { RailDragTarget, RailDropTarget, RailNavItem, RailRouteName, RailSectionName } from "./rail-sidebar-types"

export function RailSidebar(props: {
  snapshot?: GuiSnapshot
  sessions: Session[]
  pinnedSessions: Session[]
  pinnedViews: GuiSnapshot["views"]
  navItems: readonly RailNavItem[]
  activeRouteName: string
  activeSessionID: string
  activeViewID?: string
  railCollapsed: boolean
  railSectionOrder: readonly RailSectionName[]
  railSections: Record<RailSectionName, boolean>
  dragTarget?: RailDragTarget
  dropTarget?: RailDropTarget
  projectVisualOrder: readonly string[]
  projectSessions: (project: GuiSnapshot["projects"][number]) => Session[]
  projectExpanded: (projectID: string) => boolean
  sessionPinned: (sessionID: string) => boolean
  viewPinned: (viewID: string) => boolean
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
  toggleSessionPinned: (sessionID: string) => void
  toggleViewPinned: (viewID: string) => void
  startDrag: (event: DragEvent, target: RailDragTarget) => void
  dragOver: (event: DragEvent, target: RailDragTarget) => void
  clearDragTarget: () => void
  sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
  reorderRailSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  projectPointerDrag: (sourceID: string, targetID?: string, placement?: "before" | "after") => void
  reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") => void
  dropRailSection: (targetID: string, placement: "before" | "after") => void
  dropProject: (targetID: string, placement: "before" | "after") => void
  dropView: (targetID: string, placement: "before" | "after") => void
  moveRailSection: (section: RailSectionName, offset: number) => void
  moveProject: (projectID: string, offset: number) => void
  moveView: (viewID: string, offset: number) => void
}) {
  const sectionOrder = createMemo(() => {
    const source = props.dragTarget?.type === "section" ? props.dragTarget.id : undefined
    const target = props.dropTarget?.type === "section" ? props.dropTarget : undefined
    if (!source || !target) return props.railSectionOrder
    const ids = moveRelative([...props.railSectionOrder], source, target.id, target.placement)
    return ids.length === 0 ? props.railSectionOrder : ids
  })
  let sectionRowRects = new Map<string, DOMRect>()
  let sectionAnimationFrame = 0
  createEffect(() => {
    const signature = sectionOrder().join("\n")
    const active = props.dragTarget?.type === "section"
    cancelAnimationFrame(sectionAnimationFrame)
    sectionAnimationFrame = requestAnimationFrame(() => {
      sectionRowRects = animateSectionRows(sectionRowRects, active)
      void signature
    })
  })

  return (
    <aside class="rail" aria-label="OpencodeX navigation">
      <RailBrand
        snapshot={props.snapshot}
        railCollapsed={props.railCollapsed}
        openDashboard={props.openDashboard}
        toggleRail={props.toggleRail}
        createSession={() => props.createSession()}
      />
      <RailNav items={props.navItems} activeRouteName={props.activeRouteName} collapsed={props.railCollapsed} openRoute={props.openRoute} />
      <div class="rail-scroll">
        <For each={sectionOrder()}>
          {(section) => (
            <Switch>
              <Match when={section === "pinned"}>
                <RailPinnedSection
                  snapshot={props.snapshot}
                  sessions={props.pinnedSessions}
                  views={props.pinnedViews}
                  collapsed={props.railSections.pinned}
                  activeSessionID={props.activeSessionID}
                  activeViewID={props.activeViewID}
                  activeViewRoute={props.activeRouteName === "views"}
                  dragTarget={props.dragTarget}
                  dropTarget={props.dropTarget}
                  toggle={() => props.toggleRailSection("pinned")}
                  openSession={props.openSession}
                  openView={props.openView}
                  toggleSessionPinned={props.toggleSessionPinned}
                  toggleViewPinned={props.toggleViewPinned}
                  startDrag={props.startDrag}
                  dragOver={props.dragOver}
                  clearDragTarget={props.clearDragTarget}
                  sectionPointerDrag={props.sectionPointerDrag}
                  reorderSection={props.reorderRailSection}
                  dropSection={props.dropRailSection}
                  moveSection={(offset) => props.moveRailSection("pinned", offset)}
                />
              </Match>
              <Match when={section === "projects"}>
                <RailProjectsSection
                  snapshot={props.snapshot}
                  collapsed={props.railSections.projects}
                  activeSessionID={props.activeSessionID}
                  dragTarget={props.dragTarget}
                  dropTarget={props.dropTarget}
                  projectVisualOrder={props.projectVisualOrder}
                  projectSessions={props.projectSessions}
                  projectExpanded={props.projectExpanded}
                  sessionPinned={props.sessionPinned}
                  toggle={() => props.toggleRailSection("projects")}
                  toggleProject={props.toggleProject}
                  createProject={props.createProject}
                  createSession={props.createSession}
                  openSession={props.openSession}
                  toggleSessionPinned={props.toggleSessionPinned}
                  startDrag={props.startDrag}
                  dragOver={props.dragOver}
                  clearDragTarget={props.clearDragTarget}
                  sectionPointerDrag={props.sectionPointerDrag}
                  reorderSection={props.reorderRailSection}
                  projectPointerDrag={props.projectPointerDrag}
                  reorderProject={props.reorderProject}
                  dropProject={props.dropProject}
                  moveProject={props.moveProject}
                  dropSection={props.dropRailSection}
                  moveSection={(offset) => props.moveRailSection("projects", offset)}
                />
              </Match>
              <Match when={section === "recent"}>
                <RailRecentSessionsSection
                  sessions={props.sessions}
                  snapshot={props.snapshot}
                  collapsed={props.railSections.recent}
                  activeSessionID={props.activeSessionID}
                  dragTarget={props.dragTarget}
                  dropTarget={props.dropTarget}
                  sessionPinned={props.sessionPinned}
                  toggle={() => props.toggleRailSection("recent")}
                  createSession={() => props.createSession()}
                  openSession={props.openSession}
                  toggleSessionPinned={props.toggleSessionPinned}
                  startDrag={props.startDrag}
                  dragOver={props.dragOver}
                  clearDragTarget={props.clearDragTarget}
                  sectionPointerDrag={props.sectionPointerDrag}
                  reorderSection={props.reorderRailSection}
                  dropSection={props.dropRailSection}
                  moveSection={(offset) => props.moveRailSection("recent", offset)}
                />
              </Match>
              <Match when={section === "views"}>
                <RailViewsSection
                  snapshot={props.snapshot}
                  collapsed={props.railSections.views}
                  active={props.activeRouteName === "views"}
                  activeViewID={props.activeViewID}
                  dragTarget={props.dragTarget}
                  dropTarget={props.dropTarget}
                  viewPinned={props.viewPinned}
                  toggle={() => props.toggleRailSection("views")}
                  createView={props.createView}
                  openView={props.openView}
                  toggleViewPinned={props.toggleViewPinned}
                  startDrag={props.startDrag}
                  dragOver={props.dragOver}
                  clearDragTarget={props.clearDragTarget}
                  sectionPointerDrag={props.sectionPointerDrag}
                  reorderSection={props.reorderRailSection}
                  dropView={props.dropView}
                  moveView={props.moveView}
                  dropSection={props.dropRailSection}
                  moveSection={(offset) => props.moveRailSection("views", offset)}
                />
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </aside>
  )
}

function animateSectionRows(previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>("[data-rail-section-row-id]")) {
    const key = element.dataset.railSectionRowId
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
      duration: 240,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    })
  }
  return next
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
  collapsed: boolean
  openRoute: (name: RailRouteName) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const visibleItemName = createMemo(() => props.items.some((item) => item.name === props.activeRouteName) ? props.activeRouteName : props.items[0]?.name)
  return (
    <nav
      class="nav"
      classList={{ "nav-collapsed": props.collapsed, "nav-expanded": props.collapsed && expanded() }}
      onPointerEnter={() => props.collapsed && setExpanded(true)}
      onPointerLeave={(event) => {
        if (!props.collapsed) return
        if (event.currentTarget.contains(document.activeElement)) return
        setExpanded(false)
      }}
      onFocusIn={() => props.collapsed && setExpanded(true)}
      onFocusOut={(event) => {
        if (!props.collapsed) return
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setExpanded(false)
      }}
    >
      <For each={props.items}>
        {(item) => (
          <button
            aria-label={`${item.label}: ${item.description}`}
            title={`${item.label}: ${item.description} (${item.shortcut})`}
            tabIndex={props.collapsed && !expanded() && visibleItemName() !== item.name ? -1 : undefined}
            classList={{ active: props.activeRouteName === item.name, "nav-visible": visibleItemName() === item.name }}
            onClick={() => props.openRoute(item.name)}
          >
            <Icon name={item.icon} />
            <span class="nav-label">{item.label}</span>
            <small>{item.shortcut}</small>
          </button>
        )}
      </For>
    </nav>
  )
}
