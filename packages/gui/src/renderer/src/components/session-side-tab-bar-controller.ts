import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor, type Setter } from "solid-js"
import { createElementResizeTracker } from "../lib/element-resize-tracker"
import { moveRelative } from "../lib/reorder"
import { OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS, numberedDuplicateOpenTabLabels, visibleOpenTabIDs } from "../lib/open-tabs"
import { cssPixelValue, openTabLabel } from "./session-side-open-state"
import {
  OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT,
  OPEN_PANEL_OVERFLOW_VISIBLE_ROWS,
  type OpenTab,
  type OpenTabDragPreview,
  type OpenTabRow,
  type PopupMenuPlacement,
} from "./session-side-open-types"

export function createSessionSideTabBarController(input: {
  tabs: Accessor<OpenTab[]>
  setTabs: Setter<OpenTab[]>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  setActiveID: (id: string) => void
  closeTab: (id: string) => void
  hideWebTabs: () => void
  parkBrowser: () => void
  setMenuOpen: (open: boolean) => void
}) {
  const [barWidth, setBarWidth] = createSignal(0)
  const [measurements, setMeasurements] = createSignal(OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS)
  const [dragID, setDragID] = createSignal("")
  const [dropTarget, setDropTarget] = createSignal<{ id: string; placement: "before" | "after" }>()
  const [dragPreview, setDragPreview] = createSignal<OpenTabDragPreview>()
  const [placeholderWidth, setPlaceholderWidth] = createSignal(168)
  const [newMenuOpen, setNewMenuOpen] = createSignal(false)
  const [overflowMenuOpen, setOverflowMenuOpen] = createSignal(false)
  const [newMenuPlacement, setNewMenuPlacement] = createSignal<PopupMenuPlacement>()
  const [overflowMenuPlacement, setOverflowMenuPlacement] = createSignal<PopupMenuPlacement>()
  const labels = createMemo(() => numberedDuplicateOpenTabLabels(input.tabs().map((tab) => ({ id: tab.id, label: openTabLabel(tab) }))))
  const visibleTabs = createMemo(() => {
    const visible = new Set(visibleOpenTabIDs({ ids: input.tabs().map((tab) => tab.id), activeID: input.activeID(), width: barWidth(), measurements: measurements() }))
    return input.tabs().filter((tab) => visible.has(tab.id))
  })
  const rows = createMemo<OpenTabRow[]>(() => {
    const items = visibleTabs()
    const source = dragID()
    if (!source) return items.map((tab) => ({ type: "tab", tab }))
    const byID = new Map(items.map((tab) => [tab.id, tab]))
    const target = dropTarget()
    const ids = target ? moveRelative(items.map((tab) => tab.id), source, target.id, target.placement) : items.map((tab) => tab.id)
    return ids.flatMap((id): OpenTabRow[] => {
      if (id === source) return [{ type: "placeholder", id, width: placeholderWidth() }]
      const tab = byID.get(id)
      return tab ? [{ type: "tab", tab }] : []
    })
  })
  const overflowTabs = createMemo(() => {
    const visible = new Set(visibleTabs().map((tab) => tab.id))
    return input.tabs().filter((tab) => !visible.has(tab.id))
  })
  const previewTab = createMemo(() => input.tabs().find((tab) => tab.id === dragPreview()?.id))
  const previewLabel = createMemo(() => previewTab() ? label(previewTab()!) : undefined)
  let bar: HTMLDivElement | undefined
  let newMenuAnchor: HTMLButtonElement | undefined
  let newMenuPanel: HTMLDivElement | undefined
  let overflowMenuAnchor: HTMLButtonElement | undefined
  let overflowMenuPanel: HTMLDivElement | undefined
  let rowRects = new Map<string, DOMRect>()
  let rowFrame = 0
  let measureFrame = 0
  // The tab bar view unmounts whenever the session has no tabs and remounts
  // with a fresh element, so the observer has to follow the latest handover:
  // one bound at mount keeps watching the detached node and the zero width
  // measured mid-remount latches every tab into the overflow menu.
  const barResize = createElementResizeTracker(scheduleMeasure)

  createEffect(() => {
    if (overflowTabs().length > 0) return
    setOverflowMenuOpen(false)
  })

  createEffect(() => input.setMenuOpen(newMenuOpen() || overflowMenuOpen()))

  createEffect(() => {
    if (!newMenuOpen()) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (newMenuAnchor?.contains(event.target) || newMenuPanel?.contains(event.target))) return
      setNewMenuOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    onCleanup(() => document.removeEventListener("pointerdown", close, true))
  })

  createEffect(() => {
    if (!overflowMenuOpen()) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (overflowMenuAnchor?.contains(event.target) || overflowMenuPanel?.contains(event.target))) return
      setOverflowMenuOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    onCleanup(() => document.removeEventListener("pointerdown", close, true))
  })

  createEffect(() => {
    input.tabs().map((tab) => `${tab.id}:${label(tab)}`).join("\n")
    input.activeID()
    scheduleMeasure()
  })

  createEffect(() => {
    const signature = rows().map((row) => row.type === "tab" ? row.tab.id : "placeholder").join("\n")
    const active = dragID() !== ""
    scheduleMeasure()
    cancelAnimationFrame(rowFrame)
    rowFrame = requestAnimationFrame(() => {
      rowRects = animateRows(rowRects, active)
      void signature
    })
  })

  onMount(() => {
    const reposition = () => updateMenuPlacements()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    onCleanup(() => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    })
  })

  onCleanup(() => {
    barResize.dispose()
    cancelAnimationFrame(rowFrame)
    cancelAnimationFrame(measureFrame)
  })

  function label(tab: OpenTab) {
    return labels()[tab.id] ?? openTabLabel(tab)
  }

  function select(id: string) {
    if (input.activeTab()?.kind === "web" && id !== input.activeID()) input.hideWebTabs()
    input.setActiveID(id)
  }

  function selectOverflow(id: string) {
    select(id)
    setOverflowMenuOpen(false)
  }

  function toggleNewMenu() {
    const open = !newMenuOpen()
    if (open) input.parkBrowser()
    if (open) setNewMenuPlacement(initialPlacement(newMenuAnchor))
    setNewMenuOpen(open)
    setOverflowMenuOpen(false)
    requestAnimationFrame(updateMenuPlacements)
  }

  function toggleOverflowMenu() {
    const open = !overflowMenuOpen()
    if (open) input.parkBrowser()
    if (open) setOverflowMenuPlacement(initialPlacement(overflowMenuAnchor, overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS ? OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT : undefined))
    setOverflowMenuOpen(open)
    setNewMenuOpen(false)
    requestAnimationFrame(updateMenuPlacements)
  }

  function startDrag(event: PointerEvent & { currentTarget: HTMLElement }, tab: OpenTab) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".session-open-tab-close"))) return
    const pointerID = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let dragging = false
    let target: { id: string; placement: "before" | "after" } | undefined
    let lastTargetKey = ""
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID || (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5)) return
      dragging = true
      moveEvent.preventDefault()
      setDragID(tab.id)
      setPlaceholderWidth(rect.width)
      setDragPreview({ id: tab.id, x: moveEvent.clientX - offset.x, y: moveEvent.clientY - offset.y, width: rect.width, height: rect.height })
      const next = dropTargetFromPointer(tab.id, moveEvent.clientX)
      target = next
      const key = next ? `${next.id}:${next.placement}` : ""
      if (key === lastTargetKey) return
      lastTargetKey = key
      setDropTarget(next)
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
      if (!dragging) return
      finishEvent.preventDefault()
      document.addEventListener("click", suppressClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener("click", suppressClick, true), 250)
      if (target) reorder(tab.id, target.id, target.placement)
      clearDrag()
    }
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
      clearDrag()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
  }

  function reorder(sourceID: string, targetID: string, placement: "before" | "after") {
    input.setTabs((current) => {
      const ids = moveRelative(current.map((tab) => tab.id), sourceID, targetID, placement)
      const byID = new Map(current.map((tab) => [tab.id, tab]))
      return ids.map((id) => byID.get(id)).filter((tab): tab is OpenTab => tab !== undefined)
    })
  }

  function clearDrag() {
    setDragID("")
    setDropTarget(undefined)
    setDragPreview(undefined)
  }

  function scheduleMeasure() {
    cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(measure)
  }

  function measure() {
    setBarWidth(bar?.clientWidth ?? 0)
    updateMenuPlacements()
    if (!bar) return
    const root = bar
    const style = getComputedStyle(root)
    setMeasurements((current) => {
      const overflowCount = overflowTabs().length
      // Tab widths are deliberately NOT measured: tabs are flexible and stretch
      // to fill the row, so measuring them would feed the stretched width back
      // into the fit decision and make collapse one-way. Fitting always uses
      // the constant minimum width instead.
      const overflowWidth = overflowCount > 0 ? Math.ceil(overflowMenuAnchor?.getBoundingClientRect().width ?? 0) : 0
      const overflow = overflowWidth > 0 && current.overflow[overflowCount] !== overflowWidth ? { ...current.overflow, [overflowCount]: overflowWidth } : current.overflow
      const newTab = Math.ceil(newMenuAnchor?.getBoundingClientRect().width ?? current.newTab)
      const padding = cssPixelValue(style.paddingLeft) + cssPixelValue(style.paddingRight)
      const gap = cssPixelValue(style.columnGap) || cssPixelValue(style.gap)
      if (overflow === current.overflow && newTab === current.newTab && padding === current.padding && gap === current.gap) return current
      return { tabs: current.tabs, overflow, newTab, padding, gap }
    })
  }

  function updateMenuPlacements() {
    if (newMenuOpen()) placeMenu(newMenuAnchor, newMenuPanel, setNewMenuPlacement)
    if (overflowMenuOpen()) placeMenu(overflowMenuAnchor, overflowMenuPanel, setOverflowMenuPlacement, overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS ? popupRowsHeight(overflowMenuPanel, OPEN_PANEL_OVERFLOW_VISIBLE_ROWS) ?? OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT : undefined)
  }

  return {
    tabs: input.tabs, activeID: input.activeID, rows, overflowTabs, dragID, dragPreview, previewTab, previewLabel, newMenuOpen, overflowMenuOpen,
    newMenuStyle: () => placementStyle(newMenuPlacement()), overflowMenuStyle: () => placementStyle(overflowMenuPlacement()),
    label, select, selectOverflow, closeTab: input.closeTab, hideWebTabs: input.hideWebTabs, startDrag, clearDrag, toggleNewMenu, toggleOverflowMenu,
    closeNewMenu: () => setNewMenuOpen(false), closeOverflowMenu: () => setOverflowMenuOpen(false),
    setBar: (element: HTMLDivElement) => { bar = element; barResize.track(element) },
    setNewMenuAnchor: (element: HTMLButtonElement) => { newMenuAnchor = element }, setNewMenuPanel: (element: HTMLDivElement) => { newMenuPanel = element; requestAnimationFrame(updateMenuPlacements) },
    setOverflowMenuAnchor: (element: HTMLButtonElement) => { overflowMenuAnchor = element }, setOverflowMenuPanel: (element: HTMLDivElement) => { overflowMenuPanel = element; requestAnimationFrame(updateMenuPlacements) },
  }
}

function placeMenu(anchor: HTMLElement | undefined, panel: HTMLElement | undefined, setPlacement: (placement: PopupMenuPlacement) => void, maxHeight?: number) {
  if (!anchor || !panel) return
  const gap = 8
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = document.documentElement.clientHeight
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(panel.offsetWidth || 224, viewportWidth - gap * 2)
  const contentHeight = Math.min(panel.scrollHeight || panel.offsetHeight || 40, maxHeight ?? Number.POSITIVE_INFINITY)
  const below = viewportHeight - rect.bottom - gap
  const above = rect.top - gap
  const openAbove = below < contentHeight && above > below
  const height = Math.min(contentHeight, Math.max(40, openAbove ? above : below))
  const preferredLeft = rect.left + width > viewportWidth - gap ? rect.right - width : rect.left
  setPlacement({ left: Math.max(gap, Math.min(preferredLeft, viewportWidth - width - gap)), top: openAbove ? Math.max(gap, rect.top - height - gap) : Math.min(rect.bottom + gap, viewportHeight - height - gap), width, maxHeight: height })
}

function popupRowsHeight(panel: HTMLElement | undefined, rows: number) {
  if (!panel) return
  const items = Array.from(panel.querySelectorAll<HTMLElement>("button")).slice(0, rows)
  if (items.length === 0) return
  const style = getComputedStyle(panel)
  return Math.ceil(items.reduce((height, item) => height + item.getBoundingClientRect().height, 0) + Math.max(0, items.length - 1) * (cssPixelValue(style.rowGap) || cssPixelValue(style.gap)) + cssPixelValue(style.paddingTop) + cssPixelValue(style.paddingBottom))
}

function initialPlacement(anchor?: HTMLElement, maxHeight = 320): PopupMenuPlacement {
  const gap = 8
  const width = 224
  const rect = anchor?.getBoundingClientRect()
  const viewportWidth = document.documentElement.clientWidth
  return { left: Math.max(gap, Math.min(rect?.left ?? gap, viewportWidth - width - gap)), top: Math.min((rect?.bottom ?? gap) + gap, Math.max(gap, window.innerHeight - maxHeight - gap)), width, maxHeight }
}

function placementStyle(placement?: PopupMenuPlacement) {
  if (!placement) return { visibility: "hidden" as const }
  return { left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, "max-height": `${placement.maxHeight}px`, visibility: "visible" as const }
}

function dropTargetFromPointer(sourceID: string, clientX: number) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-open-tab-id]")).filter((element) => element.dataset.openTabId !== sourceID)
  const target = elements.find((element) => clientX <= element.getBoundingClientRect().right)
  if (target) {
    const rect = target.getBoundingClientRect()
    return { id: target.dataset.openTabId!, placement: clientX < rect.left + rect.width / 2 ? "before" as const : "after" as const }
  }
  const last = elements.at(-1)
  return last?.dataset.openTabId ? { id: last.dataset.openTabId, placement: "after" as const } : undefined
}

function animateRows(previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  document.querySelectorAll<HTMLElement>("[data-open-tab-row-id]").forEach((element) => {
    const key = element.dataset.openTabRowId
    if (!key) return
    const animations = element.getAnimations()
    const animatedRect = enabled && animations.length > 0 ? element.getBoundingClientRect() : undefined
    animations.forEach((animation) => animation.cancel())
    const rect = element.getBoundingClientRect()
    next.set(key, rect)
    const before = animatedRect ?? previous.get(key)
    if (!enabled || !before || Math.abs(before.left - rect.left) < 1) return
    element.animate([{ transform: `translateX(${before.left - rect.left}px)` }, { transform: "translateX(0)" }], { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" })
  })
  return next
}

function suppressClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}
