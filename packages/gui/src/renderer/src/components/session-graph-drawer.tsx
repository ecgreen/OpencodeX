import { createSignal } from "solid-js"
import type { SessionPageProps } from "./session-page-types"
import { SessionGraphSurface } from "./session-graph-surface"

const DRAWER_WIDTH_KEY = "opencodex.gui.sessionGraphDrawer.width"
const DRAWER_WIDTH_MIN = 0.28
const DRAWER_WIDTH_MAX = 0.72

/**
 * The fullscreen workspace's answer to "click a node, read its transcript".
 *
 * A measured flex sibling of the graph canvas inside the Graph tab - never an
 * overlay - so opening it *resizes* the canvas (which re-reveals the selected
 * node) instead of covering it, and switching workspace tabs takes the drawer
 * away with the tab it belongs to. Escape still closes it and closing
 * restores focus to the selected node (the embedded surface owns both).
 *
 * Below 980px the stylesheet stacks the stage vertically and hides the width
 * handle - a bottom sheet needs no column resizer.
 */
export function SessionGraphDrawer(props: { page: SessionPageProps }) {
  const [widthRatio, setWidthRatio] = createSignal(readDrawerWidthRatio())

  function startResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (event.button !== 0) return
    event.preventDefault()
    const stage = event.currentTarget.closest(".session-graph-stage")
    if (!(stage instanceof HTMLElement)) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const total = stage.clientWidth || 1
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      const fromRight = stage.getBoundingClientRect().right - next.clientX
      setWidthRatio(clampDrawerWidthRatio(fromRight / total))
    }
    const end = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      handle.releasePointerCapture?.(event.pointerId)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      writeDrawerWidthRatio(widthRatio())
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  return (
    <aside
      class="session-graph-drawer"
      style={{ "--session-graph-drawer-width": `${Math.round(widthRatio() * 10000) / 100}%` }}
      aria-label="Selected workflow step"
    >
      {/* A 24px hit area around a hairline rule, mirroring the side panel's
          splitter contract, with the separator's value exposed. */}
      <div
        class="session-graph-drawer-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the step drawer"
        aria-valuemin={Math.round(DRAWER_WIDTH_MIN * 100)}
        aria-valuemax={Math.round(DRAWER_WIDTH_MAX * 100)}
        aria-valuenow={Math.round(widthRatio() * 100)}
        tabindex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          const delta = event.key === "ArrowLeft" ? 0.04 : -0.04
          setWidthRatio((current) => clampDrawerWidthRatio(current + delta))
          writeDrawerWidthRatio(widthRatio())
        }}
      />
      <div class="session-graph-drawer-body">
        <SessionGraphSurface page={props.page} />
      </div>
    </aside>
  )
}

function clampDrawerWidthRatio(value: number) {
  if (!Number.isFinite(value)) return 0.44
  return Math.max(DRAWER_WIDTH_MIN, Math.min(DRAWER_WIDTH_MAX, value))
}

function readDrawerWidthRatio() {
  if (typeof localStorage === "undefined") return 0.44
  const parsed = Number(localStorage.getItem(DRAWER_WIDTH_KEY))
  return clampDrawerWidthRatio(Number.isFinite(parsed) && parsed > 0 ? parsed : 0.44)
}

function writeDrawerWidthRatio(value: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(DRAWER_WIDTH_KEY, String(clampDrawerWidthRatio(value)))
}
