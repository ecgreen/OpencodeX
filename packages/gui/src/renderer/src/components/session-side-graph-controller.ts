import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { SessionGraph } from "../lib/session-graph"
import { layoutSessionGraph, sessionGraphLayoutNode } from "../lib/session-graph-layout"
import {
  centerGraphViewport,
  clampGraphScale,
  fitGraphViewport,
  graphNodeVisible,
  GRAPH_ZOOM_STEP,
  IDENTITY_VIEWPORT,
  panGraphViewport,
  wheelZoomFactor,
  zoomGraphViewportAt,
  zoomGraphViewportCenter,
  type SessionGraphSize,
  type SessionGraphViewport,
} from "../lib/session-graph-viewport"

const KEYBOARD_PAN_STEP = 48

/**
 * Canvas state for the graph tab: layout, viewport, and the pointer and
 * keyboard gestures that move it.
 *
 * The graph itself is a memo over authoritative state, so live status arrives
 * as a recompute rather than a subscription here. Fit-to-view runs only while
 * the reader has not taken control of the viewport - re-framing the canvas
 * under someone who just panned somewhere is worse than leaving a new node off
 * screen, which the "fit" button recovers in one click.
 */
export function createSessionGraphViewController(input: { graph: Accessor<SessionGraph> }) {
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const [size, setSize] = createSignal<SessionGraphSize>({ width: 0, height: 0 })
  const [viewport, setViewport] = createSignal<SessionGraphViewport>(IDENTITY_VIEWPORT)
  const [hoveredEdgeID, setHoveredEdgeID] = createSignal("")
  const [hoveredNodeID, setHoveredNodeID] = createSignal("")
  const [panning, setPanning] = createSignal(false)
  /** Set once the reader pans or zooms, which stops automatic re-framing. */
  let adjusted = false

  const layout = createMemo(() => layoutSessionGraph(input.graph()))
  const parentEdge = createMemo(() => new Map(input.graph().edges.map((edge) => [edge.to, edge])))

  const measured = () => size().width > 0 && size().height > 0

  function fit() {
    if (!measured()) return
    adjusted = false
    setViewport(fitGraphViewport(layout().bounds, size()))
  }

  function zoomBy(factor: number) {
    if (!measured()) return
    adjusted = true
    setViewport((current) => zoomGraphViewportCenter(current, size(), factor))
  }

  function pan(dx: number, dy: number) {
    adjusted = true
    setViewport((current) => panGraphViewport(current, dx, dy))
  }

  /** Brings a node into view without changing zoom; a visible node is left alone. */
  function reveal(nodeID: string) {
    const placed = sessionGraphLayoutNode(layout(), nodeID)
    if (!placed || !measured()) return
    const box = { x: placed.x, y: placed.y, width: placed.width, height: placed.height }
    if (graphNodeVisible(viewport(), box, size())) return
    adjusted = true
    setViewport((current) => centerGraphViewport(current, box, size()))
  }

  // Re-frame when the shape of the graph or the pane changes, never on a status
  // update: a node turning green must not move the canvas.
  createEffect(
    on(
      () => `${layout().nodes.length}:${size().width}x${size().height}`,
      () => {
        if (adjusted || !measured()) return
        setViewport(fitGraphViewport(layout().bounds, size()))
      },
    ),
  )

  createEffect(() => {
    const element = canvas()
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: box.width, height: box.height })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    onCleanup(() => observer.disconnect())
  })

  // Wheel is bound by hand so it can be non-passive: without preventDefault the
  // side panel scrolls behind the canvas while the reader is zooming.
  createEffect(() => {
    const element = canvas()
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey && event.deltaY === 0) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      adjusted = true
      setViewport((current) =>
        zoomGraphViewportAt(
          current,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          wheelZoomFactor(event.deltaY),
        ),
      )
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    onCleanup(() => element.removeEventListener("wheel", onWheel))
  })

  /** Drag anywhere on the background pans. Nodes stop the event themselves. */
  function startPan(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    setPanning(true)
    let lastX = event.clientX
    let lastY = event.clientY
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      pan(next.clientX - lastX, next.clientY - lastY)
      lastX = next.clientX
      lastY = next.clientY
    }
    const end = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      setPanning(false)
      target.releasePointerCapture?.(event.pointerId)
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", end)
      target.removeEventListener("pointercancel", end)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", end)
    target.addEventListener("pointercancel", end)
  }

  function handleKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? KEYBOARD_PAN_STEP * 2 : KEYBOARD_PAN_STEP
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const delta = pans[event.key]
    if (delta) {
      event.preventDefault()
      pan(delta[0], delta[1])
      return
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      zoomBy(GRAPH_ZOOM_STEP)
      return
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault()
      zoomBy(1 / GRAPH_ZOOM_STEP)
      return
    }
    if (event.key !== "0") return
    event.preventDefault()
    fit()
  }

  return {
    canvas,
    setCanvas,
    layout,
    viewport,
    size,
    panning,
    hoveredEdgeID,
    setHoveredEdgeID,
    hoveredNodeID,
    setHoveredNodeID,
    /** The edge that spawned a node, for the node's own hover detail. */
    incomingEdge: (nodeID: string) => parentEdge().get(nodeID),
    zoomPercent: () => Math.round(clampGraphScale(viewport().scale) * 100),
    zoomIn: () => zoomBy(GRAPH_ZOOM_STEP),
    zoomOut: () => zoomBy(1 / GRAPH_ZOOM_STEP),
    fit,
    reveal,
    startPan,
    handleKeyDown,
  }
}
