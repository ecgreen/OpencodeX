import type { RailDragTarget, RailDropTarget, RailSectionName } from "./rail-sidebar-types"

export function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

export function suppressNextPointerClick() {
  const suppress = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  document.addEventListener("click", suppress, { capture: true, once: true })
  const timer = window.setTimeout(() => document.removeEventListener("click", suppress, true), 250)
  return () => {
    window.clearTimeout(timer)
    document.removeEventListener("click", suppress, true)
  }
}

export function sectionDrag(
  id: RailSectionName,
  props: {
    dragTarget?: RailDragTarget
    dropTarget?: RailDropTarget
    startDrag: (event: DragEvent, target: RailDragTarget) => void
    dragOver: (event: DragEvent, target: RailDragTarget) => void
    clearDragTarget: () => void
    sectionPointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
    reorderSection: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
    dropSection: (targetID: string, placement: "before" | "after") => void
    moveSection: (offset: number) => void
  },
) {
  return {
    target: { type: "section" as const, id },
    active: props.dragTarget?.type === "section" && props.dragTarget.id === id,
    dropping: props.dropTarget?.type === "section" && props.dropTarget.id === id ? props.dropTarget.placement : undefined,
    start: props.startDrag,
    over: props.dragOver,
    drop: props.dropSection,
    clear: props.clearDragTarget,
    move: props.moveSection,
    pointerDrag: props.sectionPointerDrag,
    pointerDrop: props.reorderSection,
  }
}
