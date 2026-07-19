export function RailResizeHandle(props: {
  width: () => number
  resize: (width: number) => void
  setResizing: (resizing: boolean) => void
}) {
  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    const handle = event.currentTarget
    const pointerID = event.pointerId
    const startX = event.clientX
    const startWidth = props.width()
    handle.setPointerCapture?.(pointerID)
    props.setResizing(true)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      props.resize(startWidth + moveEvent.clientX - startX)
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerID) return
      props.setResizing(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      if (handle.hasPointerCapture?.(pointerID)) handle.releasePointerCapture?.(pointerID)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
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
