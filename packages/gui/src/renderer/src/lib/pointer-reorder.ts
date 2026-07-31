import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { moveRelative } from "./reorder"

/**
 * Pointer drag-to-reorder for a vertical list, with the FLIP pass that settles
 * the rows afterwards. Projects, views, and the rail all reorder the same way,
 * so the behaviour lives here once and each list supplies only its own
 * attributes and its own commit.
 */

export type ReorderPlacement = "before" | "after"
export type ReorderDropTarget = { id: string; placement: ReorderPlacement }
export type PointerReorderPreview = { id: string; x: number; y: number; width: number; height: number }
export type ReorderRow<T> =
  | { type: "item"; id: string; item: T }
  | { type: "placeholder"; id: string; height: number }

/** Below this the pointer is still a click, so the row stays put. */
const DRAG_THRESHOLD_PX = 5
const MOVE_ANIMATION_MS = 360
/** A drag ends over the row it started on, so the click that follows is not an open. */
const CLICK_SUPPRESSION_MS = 250
const FLIP_DURATION_MS = 220
const FLIP_EASING = "cubic-bezier(0.16, 1, 0.3, 1)"
const DEFAULT_PLACEHOLDER_HEIGHT = 72

export type PointerReorderOptions<T> = {
  items: () => T[]
  getID: (item: T) => string
  /** Marks a draggable row, e.g. `data-project-row-id`. */
  rowAttribute: string
  /** Marks everything the FLIP pass animates, placeholders included. */
  layoutAttribute: string
  /** A pointer-down inside this selector is an action, not a drag. */
  ignoreSelector?: string
  onReorder: (sourceID: string, target: ReorderDropTarget) => void
}

export function createPointerReorder<T>(options: PointerReorderOptions<T>) {
  const [dragID, setDragID] = createSignal("")
  const [dropTarget, setDropTarget] = createSignal<ReorderDropTarget>()
  const [preview, setPreview] = createSignal<PointerReorderPreview>()
  const [placeholderHeight, setPlaceholderHeight] = createSignal(DEFAULT_PLACEHOLDER_HEIGHT)
  const [movingRow, setMovingRow] = createSignal<{ id: string; direction: "up" | "down" }>()
  const [suppressedID, setSuppressedID] = createSignal("")
  const rowKey = datasetKey(options.rowAttribute)
  const layoutKey = datasetKey(options.layoutAttribute)
  const cleanups = new Set<() => void>()
  const timers = new Set<number>()
  let rects = new Map<string, DOMRect>()

  const visibleIDs = createMemo(() => options.items().map(options.getID))
  const rows = createMemo<ReorderRow<T>[]>(() => {
    const source = dragID()
    const items = options.items()
    if (!source) return items.map((item) => ({ type: "item", id: options.getID(item), item }))
    const byID = new Map(items.map((item) => [options.getID(item), item]))
    const target = dropTarget()
    const ids = target ? moveRelative(visibleIDs(), source, target.id, target.placement) : visibleIDs()
    return (ids.length === 0 ? visibleIDs() : ids).flatMap((id): ReorderRow<T>[] => {
      if (id === source) return [{ type: "placeholder", id: source, height: placeholderHeight() }]
      const item = byID.get(id)
      return item ? [{ type: "item", id, item }] : []
    })
  })
  const previewItem = createMemo(() => options.items().find((item) => options.getID(item) === preview()?.id))

  onCleanup(() => {
    cleanups.forEach((cleanup) => cleanup())
    timers.forEach((timer) => window.clearTimeout(timer))
  })

  createEffect(() => {
    const signature = rows().map((row) => row.type === "item" ? row.id : `placeholder:${row.id}:${row.height}`).join("\n")
    const active = dragID() !== ""
    const frame = requestAnimationFrame(() => {
      rects = animateRows(rects, active, options.layoutAttribute, layoutKey)
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

  /** Flags the row so it plays the settle animation, whatever moved it. */
  function markMoved(id: string, direction: "up" | "down") {
    setMovingRow({ id, direction })
    schedule(() => setMovingRow((current) => current?.id === id ? undefined : current), MOVE_ANIMATION_MS)
  }

  function clearDrag() {
    setDragID("")
    setDropTarget(undefined)
    setPreview(undefined)
  }

  function startDrag(event: PointerEvent & { currentTarget: HTMLElement }, sourceID: string) {
    if (event.button !== 0) return
    if (options.ignoreSelector && event.target instanceof Element && event.target.closest(options.ignoreSelector)) return
    const pointerID = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let dragging = false
    let target: ReorderDropTarget | undefined
    let lastTargetKey = ""

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < DRAG_THRESHOLD_PX) return
      dragging = true
      moveEvent.preventDefault()
      setDragID(sourceID)
      setPlaceholderHeight(rect.height)
      setPreview({
        id: sourceID,
        x: moveEvent.clientX - offset.x,
        y: moveEvent.clientY - offset.y,
        width: rect.width,
        height: rect.height,
      })
      const next = dropTargetFromPointer(options.rowAttribute, rowKey, sourceID, moveEvent.clientY)
      if (!next) {
        target = undefined
        if (lastTargetKey === "") return
        setDropTarget(undefined)
        lastTargetKey = ""
        return
      }
      target = next
      const key = `${next.id}:${next.placement}`
      if (key === lastTargetKey) return
      lastTargetKey = key
      setDropTarget(next)
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      cleanups.delete(cleanup)
    }

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerID) return
      cleanup()
      if (!dragging) return
      upEvent.preventDefault()
      setSuppressedID(sourceID)
      schedule(() => setSuppressedID((current) => current === sourceID ? "" : current), CLICK_SUPPRESSION_MS)
      const committed = target
      clearDrag()
      if (!committed) return
      const ordered = moveRelative(visibleIDs(), sourceID, committed.id, committed.placement)
      const from = visibleIDs().indexOf(sourceID)
      const to = ordered.indexOf(sourceID)
      if (from !== -1 && to !== -1) markMoved(sourceID, to < from ? "up" : "down")
      options.onReorder(sourceID, committed)
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      cleanup()
      clearDrag()
    }

    cleanups.add(cleanup)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }

  return {
    rows,
    preview,
    previewItem,
    startDrag,
    markMoved,
    dragging: (id: string) => dragID() === id,
    dropping: (id: string) => dropTarget()?.id === id ? dropTarget()?.placement : undefined,
    moving: (id: string) => movingRow()?.id === id ? movingRow()?.direction : undefined,
    /** True while the click that ends a drag is still in flight. */
    suppressed: (id: string) => suppressedID() === id,
  }
}

/** `data-project-row-id` -> `projectRowId`, the shape `element.dataset` uses. */
function datasetKey(attribute: string) {
  return attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function dropTargetFromPointer(attribute: string, key: string, sourceID: string, clientY: number): ReorderDropTarget | undefined {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`))
    .filter((element) => element.dataset[key] !== sourceID)
  const before = rows.find((element) => {
    const rect = element.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2
  })
  if (before?.dataset[key]) return { id: before.dataset[key], placement: "before" }
  const after = rows.at(-1)?.dataset[key]
  return after ? { id: after, placement: "after" } : undefined
}

/**
 * FLIP: measure where every row landed, then play it back from where it was.
 * A row mid-animation is measured at its animated position so an interrupted
 * move continues from where the eye last saw it rather than snapping.
 */
function animateRows(previous: Map<string, DOMRect>, enabled: boolean, attribute: string, key: string) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    const id = element.dataset[key]
    if (!id) continue
    const animations = element.getAnimations()
    const animatedRect = enabled && animations.length > 0 ? element.getBoundingClientRect() : undefined
    animations.forEach((animation) => animation.cancel())
    const rect = element.getBoundingClientRect()
    next.set(id, rect)
    const before = animatedRect ?? previous.get(id)
    if (!enabled || !before) continue
    const deltaY = before.top - rect.top
    if (Math.abs(deltaY) < 1) continue
    element.animate(
      [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
      { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
    )
  }
  return next
}
