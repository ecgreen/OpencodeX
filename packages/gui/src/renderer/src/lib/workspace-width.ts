import { createSignal, onCleanup } from "solid-js"
import { createResizeSession } from "./resize-session"
import { clampWorkspaceWidthRatio, WORKSPACE_WIDTH_MAX, WORKSPACE_WIDTH_MIN } from "./workspace-layout"

/**
 * Dragging the workspace wider or narrower.
 *
 * One implementation for both routes that have a workspace. A view's panel is
 * the session panel pointed at whichever session the view is prioritising, so
 * it has to resize by the same rules - and it now parks embedded browsers while
 * dragging, which the view's own copy of this never did.
 */

export function createWorkspaceWidth(input: {
  read: () => number
  write: (value: number) => void
}) {
  const [widthRatio, setWidthRatio] = createSignal(clampWorkspaceWidthRatio(input.read()))
  const cleanups = new Set<() => void>()
  onCleanup(() => cleanups.forEach((cleanup) => cleanup()))

  function setPersisted(value: number) {
    const next = clampWorkspaceWidthRatio(value)
    setWidthRatio(next)
    input.write(next)
  }

  function startResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    // A second drag replaces the first rather than racing it.
    cleanups.forEach((cleanup) => cleanup())
    const handle = event.currentTarget
    const pointerID = event.pointerId
    handle.setPointerCapture?.(pointerID)
    // Embedded browsers are parked for the duration: a live <webview> repainting
    // through a drag is what made resizing feel like it was fighting back.
    window.dispatchEvent(new CustomEvent("opencodex:session-side-panel-resize-start"))
    const container = handle.parentElement
    container?.classList.add("resizing")
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = widthRatio()
    const resize = createResizeSession(startRatio, { preview: setWidthRatio, persist: input.write })
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      resize.update(clampWorkspaceWidthRatio(startRatio - (moveEvent.clientX - startX) / containerWidth))
    }
    const cleanup = () => {
      if (!cleanups.delete(cleanup)) return
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      if (handle.hasPointerCapture?.(pointerID)) handle.releasePointerCapture?.(pointerID)
      container?.classList.remove("resizing")
      resize.finish()
      window.dispatchEvent(new CustomEvent("opencodex:session-side-panel-resize-end"))
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerID) cleanup()
    }
    cleanups.add(cleanup)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  function toggleMaximized() {
    setPersisted(widthRatio() >= WORKSPACE_WIDTH_MAX - 0.02 ? 0.4 : WORKSPACE_WIDTH_MAX)
  }

  function resizeByKeyboard(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault()
      toggleMaximized()
      return
    }
    const next = event.key === "ArrowLeft" ? widthRatio() + 0.04
      : event.key === "ArrowRight" ? widthRatio() - 0.04
        : event.key === "Home" ? WORKSPACE_WIDTH_MIN
          : event.key === "End" ? WORKSPACE_WIDTH_MAX
            : undefined
    if (next === undefined) return
    event.preventDefault()
    setPersisted(next)
  }

  return { widthRatio, setPersisted, startResize, toggleMaximized, resizeByKeyboard }
}
