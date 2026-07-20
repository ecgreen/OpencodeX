import { Button } from "./ui"
import type { JSX } from "solid-js"
import { Show, createSignal, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "./icon"
import { suppressNextPointerClick } from "./rail-sidebar-drag"
import type { RailDragTarget, RailSectionName } from "./rail-sidebar-types"

type RailSectionDragTarget = Extract<RailDragTarget, { type: "section" }>
type RailSectionDragPreview = { id: RailSectionName; title: string; count: number; x: number; y: number; width: number }

export function RailSection(props: {
  title: string
  count: number
  collapsed: boolean
  toggle: () => void
  action?: () => void
  children: JSX.Element
  drag?: {
    target: RailSectionDragTarget
    active: boolean
    dropping?: "before" | "after"
    start: (event: DragEvent, target: RailSectionDragTarget) => void
    over: (event: DragEvent, target: RailSectionDragTarget) => void
    drop: (targetID: string, placement: "before" | "after") => void
    clear: () => void
    move: (offset: number) => void
    pointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
    pointerDrop: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  }
}) {
  const [preview, setPreview] = createSignal<RailSectionDragPreview>()
  let stopPointerDrag: (() => void) | undefined
  let stopClickSuppression: (() => void) | undefined

  onCleanup(() => {
    stopPointerDrag?.()
    stopClickSuppression?.()
    props.drag?.clear()
  })

  function suppressClick() {
    stopClickSuppression?.()
    stopClickSuppression = suppressNextPointerClick()
  }

  return (
    <section
      class="rail-section"
      classList={{ "section-slot-placeholder": props.drag?.active }}
      data-rail-section-row-id={props.drag?.target.id}
    >
      <header
        data-rail-section-id={props.drag?.target.id}
        classList={{
          dragging: props.drag?.active,
          dropping: props.drag?.dropping !== undefined,
          "drop-after": props.drag?.dropping === "after",
          "no-action": props.action === undefined,
        }}
        onPointerDown={(event) => {
          if (!props.drag) return
          stopPointerDrag?.()
          stopPointerDrag = startRailSectionPointerDrag(event, props.drag, { title: props.title, count: props.count }, setPreview, suppressClick)
        }}
        onDragStart={(event) => props.drag?.start(event, props.drag.target)}
        onDragOver={(event) => props.drag?.over(event, props.drag.target)}
        onDrop={(event) => props.drag?.drop(props.drag.target.id, dropPlacement(event))}
        onDragEnd={() => props.drag?.clear()}
      >
        <Button appearance="ghost"
          class="section-toggle"
          aria-expanded={!props.collapsed}
          onClick={props.toggle}
          onKeyDown={(event) => {
            if (!props.drag || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
            event.preventDefault()
            props.drag.move(event.key === "ArrowUp" ? -1 : 1)
          }}
        >
          <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
          <strong>{props.title} <span class="section-count">({props.count})</span></strong>
        </Button>
        {props.action && <Button appearance="ghost" class="section-new" title={`Create ${props.title}`} aria-label={`Create ${props.title}`} onClick={props.action}>+ New</Button>}
      </header>
      <div class="rail-section-content" classList={{ collapsed: props.collapsed }}>
        <div>
          <Show when={!props.collapsed}>{props.children}</Show>
        </div>
      </div>
      <RailSectionDragPreviewView preview={preview()} />
    </section>
  )
}

function startRailSectionPointerDrag(
  event: PointerEvent & { currentTarget: HTMLElement },
  drag: {
    target: RailSectionDragTarget
    pointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
    pointerDrop: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
    clear: () => void
  },
  label: { title: string; count: number },
  setPreview: (value?: RailSectionDragPreview) => void,
  suppressClick: () => void,
) {
  if (event.button !== 0) return
  const pointerID = event.pointerId
  const sourceRect = event.currentTarget.getBoundingClientRect()
  const origin = { x: event.clientX, y: event.clientY }
  const offset = { x: event.clientX - sourceRect.left, y: event.clientY - sourceRect.top }
  let dragging = false
  let active = true
  let target: { id: RailSectionName; placement: "before" | "after" } | undefined
  let lastTargetKey = ""

  const cleanup = () => {
    if (!active) return
    active = false
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
  }

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerID) return
    if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return
    dragging = true
    moveEvent.preventDefault()
    setPreview({
      id: drag.target.id,
      title: label.title,
      count: label.count,
      x: moveEvent.clientX - offset.x,
      y: moveEvent.clientY - offset.y,
      width: sourceRect.width,
    })
    const nextTarget = railSectionDropTargetFromPointer(drag.target.id, moveEvent.clientY)
    if (!nextTarget) {
      target = undefined
      if (lastTargetKey !== "") {
        drag.pointerDrag(drag.target.id)
        lastTargetKey = ""
      }
      return
    }
    target = nextTarget
    const targetKey = `${target.id}:${target.placement}`
    if (targetKey === lastTargetKey) return
    lastTargetKey = targetKey
    drag.pointerDrag(drag.target.id, target.id, target.placement)
  }

  const up = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerID) return
    cleanup()
    if (!dragging) return
    upEvent.preventDefault()
    suppressClick()
    if (!target) {
      setPreview(undefined)
      drag.clear()
      return
    }
    drag.pointerDrop(drag.target.id, target.id, target.placement)
    setPreview(undefined)
  }

  const cancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerID) return
    cleanup()
    setPreview(undefined)
    drag.clear()
  }

  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
  return cleanup
}

function RailSectionDragPreviewView(props: { preview?: RailSectionDragPreview }) {
  return (
    <Show when={props.preview}>
      {(preview) => (
        <Portal>
          <div
            class="rail-section-drag-preview"
            style={{ left: `${preview().x}px`, top: `${preview().y}px`, width: `${preview().width}px` }}
          >
            <span class="section-chevron"><Icon name="chevronDown" /></span>
            <strong>{preview().title} <span class="section-count">({preview().count})</span></strong>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function railSectionName(value: string | undefined): RailSectionName | undefined {
  if (value === "pinned" || value === "projects" || value === "recent" || value === "prior" || value === "views") return value
  return undefined
}

function railSectionDropTargetFromPointer(sourceID: RailSectionName, clientY: number) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-rail-section-id]"))
    .filter((element) => element.dataset.railSectionId !== sourceID)
  for (const element of elements) {
    const id = railSectionName(element.dataset.railSectionId)
    if (!id) continue
    const rect = element.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return { id, placement: "before" as const }
  }
  const id = railSectionName(elements.at(-1)?.dataset.railSectionId)
  return id ? { id, placement: "after" as const } : undefined
}

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}
