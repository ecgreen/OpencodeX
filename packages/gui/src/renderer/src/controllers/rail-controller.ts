import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { RailDragTarget, RailDropTarget, RailSectionName } from "../components/rail-sidebar"
import type { GuiClient } from "../lib/client"
import { droppedReorderIDs, mergeOrderedIDs, moveByOffset } from "../lib/reorder"
import {
  DEFAULT_RAIL_SECTION_ORDER,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  dropPlacement,
  readSidebarPreferences,
  writeSidebarPreferences,
} from "../lib/sidebar-preferences"
import { reorderProjects, reorderViews, type GuiSnapshot } from "../lib/store"

export function createRailController(input: {
  client: Accessor<GuiClient | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  visibleSessions: Accessor<Session[]>
  missingSessionIDs: Accessor<ReadonlySet<string>>
  ensureSessionCards: (sessionIDs: readonly string[]) => Promise<unknown>
  refresh: () => Promise<void>
}) {
  const preferences = readSidebarPreferences()
  const [collapsed, setCollapsed] = createSignal(preferences.railCollapsed)
  const [width, setWidthSignal] = createSignal(preferences.railWidth)
  const [resizing, setResizing] = createSignal(false)
  const [sectionOrder, setSectionOrder] = createSignal<RailSectionName[]>(preferences.railSectionOrder)
  const [sections, setSections] = createSignal<Record<RailSectionName, boolean>>(preferences.railSections)
  const [expandedProjectIDs, setExpandedProjectIDs] = createSignal(preferences.expandedProjectIDs)
  const [pinnedSessionIDs, setPinnedSessionIDs] = createSignal(preferences.pinnedSessionIDs)
  const [pinnedViewIDs, setPinnedViewIDs] = createSignal(preferences.pinnedViewIDs)
  const [dragTarget, setDragTarget] = createSignal<RailDragTarget>()
  const [dropTarget, setDropTarget] = createSignal<RailDropTarget>()
  const [projectVisualOrder, setProjectVisualOrder] = createSignal<string[]>([])

  const pinnedSessionIDSet = createMemo(() => new Set(pinnedSessionIDs()))
  const pinnedViewIDSet = createMemo(() => new Set(pinnedViewIDs()))
  const pinnedSessions = createMemo(() => {
    const sessions = new Map(input.visibleSessions().map((session) => [session.id, session]))
    return pinnedSessionIDs()
      .map((id) => sessions.get(id))
      .filter((session): session is Session => session !== undefined)
  })
  const pinnedViews = createMemo(() => {
    const views = new Map((input.snapshot()?.views ?? []).map((view) => [view.id, view]))
    return pinnedViewIDs()
      .map((id) => views.get(id))
      .filter((view): view is ClientCatalogView => view !== undefined)
  })

  createEffect(() => {
    if (resizing()) return
    writeSidebarPreferences({
      railCollapsed: collapsed(),
      railWidth: width(),
      railSectionOrder: sectionOrder(),
      railSections: sections(),
      expandedProjectIDs: expandedProjectIDs(),
      pinnedSessionIDs: pinnedSessionIDs(),
      pinnedViewIDs: pinnedViewIDs(),
    })
  })

  createEffect(() => {
    const snapshot = input.snapshot()
    if (!snapshot) return
    const missingSessionIDs = input.missingSessionIDs()
    const viewIDs = new Set(snapshot.views.map((view) => view.id))
    const sessions = pinnedSessionIDs().filter((id) => !missingSessionIDs.has(id))
    const views = pinnedViewIDs().filter((id) => viewIDs.has(id))
    if (sessions.join("\n") !== pinnedSessionIDs().join("\n")) setPinnedSessionIDs(sessions)
    if (views.join("\n") !== pinnedViewIDs().join("\n")) setPinnedViewIDs(views)
  })

  createEffect(() => {
    const unresolved = (input.snapshot()?.projects ?? []).flatMap((project) =>
      projectExpanded(project.id) && project.sessions.length === 0 ? project.sessionIDs.slice(0, 3) : [],
    )
    if (unresolved.length > 0) void input.ensureSessionCards(unresolved).catch(() => undefined)
  })

  createEffect(() => {
    const order = projectVisualOrder()
    if (order.length === 0) return
    if ((input.snapshot()?.projects ?? []).map((project) => project.id).join("\n") === order.join("\n"))
      setProjectVisualOrder([])
  })

  function toggleSection(name: RailSectionName) {
    setSections((current) => ({ ...current, [name]: !current[name] }))
  }

  function setWidth(value: number) {
    setWidthSignal(Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, value))))
  }

  function toggleSessionPinned(sessionID: string) {
    setPinnedSessionIDs((current) =>
      current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID],
    )
  }

  function pinSession(sessionID: string) {
    setPinnedSessionIDs((current) => (current.includes(sessionID) ? current : [...current, sessionID]))
  }

  function toggleViewPinned(viewID: string) {
    setPinnedViewIDs((current) =>
      current.includes(viewID) ? current.filter((id) => id !== viewID) : [...current, viewID],
    )
  }

  function projectExpanded(projectID: string) {
    return expandedProjectIDs()[projectID] ?? true
  }

  function toggleProject(projectID: string) {
    if (!projectExpanded(projectID)) {
      const project = input.snapshot()?.projects.find((item) => item.id === projectID)
      if (project) void input.ensureSessionCards(project.sessionIDs.slice(0, 3)).catch(() => undefined)
    }
    setExpandedProjectIDs((current) => ({ ...current, [projectID]: !projectExpanded(projectID) }))
  }

  function projectOrderIDs() {
    const ids = (input.snapshot()?.projects ?? []).map((project) => project.id)
    return projectVisualOrder().length === 0 ? ids : mergeOrderedIDs(ids, projectVisualOrder())
  }

  function clearDragTarget() {
    setDragTarget(undefined)
    setDropTarget(undefined)
  }

  function moveSection(section: RailSectionName, offset: number) {
    const order = moveByOffset(sectionOrder(), section, offset)
    if (order.length === 0) return
    setSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, order))
  }

  function reorderSection(sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") {
    const order = droppedReorderIDs({
      ids: sectionOrder(),
      source: { type: "section", id: sourceID },
      sourceType: "section",
      targetID,
      placement,
    })
    if (order.length > 0) setSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, order))
    clearDragTarget()
  }

  function dropSection(targetID: string, placement: "before" | "after") {
    const order = droppedReorderIDs({
      ids: sectionOrder(),
      source: dragTarget(),
      sourceType: "section",
      targetID,
      placement,
    })
    if (order.length > 0) setSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, order))
    clearDragTarget()
  }

  async function moveProject(projectID: string, offset: number) {
    const ids = moveByOffset(projectOrderIDs(), projectID, offset)
    const client = input.client()
    if (!client || ids.length === 0) return
    setProjectVisualOrder(ids)
    await reorderProjects(client, ids)
    await input.refresh()
  }

  async function moveView(viewID: string, offset: number) {
    const ids = moveByOffset(
      (input.snapshot()?.views ?? []).map((view) => view.id),
      viewID,
      offset,
    )
    const client = input.client()
    if (!client || ids.length === 0) return
    await reorderViews(client, ids)
    await input.refresh()
  }

  async function reorderViewIDs(ids: string[]) {
    const client = input.client()
    if (!client || ids.length === 0) return
    await reorderViews(client, ids)
    await input.refresh()
  }

  async function dropProject(targetID: string, placement: "before" | "after", source = dragTarget()) {
    const ids = droppedReorderIDs({ ids: projectOrderIDs(), source, sourceType: "project", targetID, placement })
    const client = input.client()
    if (!client || ids.length === 0) {
      clearDragTarget()
      return
    }
    setProjectVisualOrder(ids)
    clearDragTarget()
    await reorderProjects(client, ids)
    await input.refresh()
  }

  async function dropView(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    clearDragTarget()
    const ids = droppedReorderIDs({
      ids: (input.snapshot()?.views ?? []).map((view) => view.id),
      source,
      sourceType: "view",
      targetID,
      placement,
    })
    const client = input.client()
    if (!client || ids.length === 0) return
    await reorderViews(client, ids)
    await input.refresh()
  }

  function startDrag(event: DragEvent, target: RailDragTarget) {
    setDragTarget(target)
    setDropTarget(undefined)
    event.dataTransfer?.setData("text/plain", target.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  function dragOver(event: DragEvent, target: RailDragTarget) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    const source = dragTarget()
    if (!source || source.type !== target.type || source.id === target.id) {
      setDropTarget(undefined)
      return
    }
    setDropTarget({ ...target, placement: dropPlacement(event) })
  }

  function projectPointerDrag(sourceID: string, targetID?: string, placement?: "before" | "after") {
    setDragTarget({ type: "project", id: sourceID })
    setDropTarget(targetID && placement ? { type: "project", id: targetID, placement } : undefined)
  }

  function sectionPointerDrag(sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") {
    setDragTarget({ type: "section", id: sourceID })
    setDropTarget(targetID && placement ? { type: "section", id: targetID, placement } : undefined)
  }

  return {
    collapsed,
    setCollapsed,
    width,
    setWidth,
    resizing,
    setResizing,
    sectionOrder,
    sections,
    dragTarget,
    dropTarget,
    projectVisualOrder,
    pinnedSessionIDSet,
    pinnedViewIDSet,
    pinnedSessions,
    pinnedViews,
    toggleSection,
    toggleSessionPinned,
    pinSession,
    toggleViewPinned,
    projectExpanded,
    toggleProject,
    moveSection,
    reorderSection,
    dropSection,
    moveProject,
    moveView,
    reorderViewIDs,
    dropProject,
    reorderProject: (sourceID: string, targetID: string, placement: "before" | "after") =>
      dropProject(targetID, placement, { type: "project", id: sourceID }),
    dropView,
    startDrag,
    dragOver,
    projectPointerDrag,
    sectionPointerDrag,
    clearDragTarget,
  }
}
