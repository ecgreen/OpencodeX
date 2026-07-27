import { onCleanup } from "solid-js"
import { createResizeSession } from "../lib/resize-session"

export function RailResizeHandle(props: {
  width: () => number
  resize: (width: number) => void
  setResizing: (resizing: boolean) => void
}) {
  let finishActiveDrag: (() => void) | undefined
  onCleanup(() => finishActiveDrag?.())

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    finishActiveDrag?.()
    const handle = event.currentTarget
    const pointerID = event.pointerId
    const startX = event.clientX
    const startWidth = props.width()
    handle.setPointerCapture?.(pointerID)
    props.setResizing(true)
    const resize = createResizeSession(startWidth, {
      preview: props.resize,
      persist: () => props.setResizing(false),
    })
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      resize.update(startWidth + moveEvent.clientX - startX)
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finishFromEvent)
      window.removeEventListener("pointercancel", finishFromEvent)
      if (handle.hasPointerCapture?.(pointerID)) handle.releasePointerCapture?.(pointerID)
      resize.finish()
      if (finishActiveDrag === finish) finishActiveDrag = undefined
    }
    const finishFromEvent = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerID) return
      finish()
    }
    finishActiveDrag = finish
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finishFromEvent)
    window.addEventListener("pointercancel", finishFromEvent)
  }

  return (
    <div
      class="rail-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          props.resize(props.width() - 16)
          return
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          props.resize(props.width() + 16)
        }
      }}
    />
  )
}
