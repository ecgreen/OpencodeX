import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { sessionGraphStructure, type SessionGraph } from "../lib/session-graph"
import { layoutSessionGraph, sessionGraphLayoutNode, spatialGraphNeighbor } from "../lib/session-graph-layout"
import {
  centerGraphViewport,
  clampGraphScale,
  clampGraphViewportPan,
  fitGraphViewport,
  frameGraphViewport,
  graphNodeVisible,
  offscreenGraphSummary,
  GRAPH_ZOOM_STEP,
  IDENTITY_VIEWPORT,
  panGraphViewport,
  wheelZoomFactor,
  zoomGraphViewportAt,
  zoomGraphViewportCenter,
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
export function createSessionGraphViewController(input: {
  graph: Accessor<SessionGraph>
  /** The activated node, so automatic framing can centre what matters. */
  selectedNodeID?: Accessor<string>
}) {
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const [size, setSize] = createSignal({ width: 0, height: 0 }, { equals: (a, b) => a.width === b.width && a.height === b.height })
  // Value equality, not identity: every transform helper returns a fresh
  // object, and a same-valued write must not notify - a subscriber that
  // re-derives the same viewport would otherwise loop the app into a freeze.
  const [viewport, setViewport] = createSignal(IDENTITY_VIEWPORT, {
    equals: (a, b) => a.x === b.x && a.y === b.y && a.scale === b.scale,
  })
  const [hoveredEdgeID, setHoveredEdgeID] = createSignal("")
  const [hoveredNodeID, setHoveredNodeID] = createSignal("")
  const [panning, setPanning] = createSignal(false)
  /** Set once the reader pans or zooms, which stops automatic re-framing. */
  let adjusted = false

  const layout = createMemo(() => layoutSessionGraph(input.graph()))
  // Every incoming edge, not just the last one to be emitted: a merge or a
  // multi-input planned step has several, and the node tooltip is the only
  // place a keyboard reader can discover them.
  const parentEdges = createMemo(() => {
    const grouped = new Map<string, ReturnType<typeof input.graph>["edges"]>()
    for (const edge of input.graph().edges) grouped.set(edge.to, [...(grouped.get(edge.to) ?? []), edge])
    return grouped
  })

  // See sessionGraphStructure: identity and shape, never status.
  const structure = createMemo(() => sessionGraphStructure(input.graph()))

  const measured = () => size().width > 0 && size().height > 0

  /**
   * The box automatic framing centres when the whole graph cannot fit at a
   * readable scale: the selected node, else the highest-attention node
   * (blocked > failed > review > running), else the root.
   */
  const focusBox = createMemo(() => {
    const placed = layout().nodes
    const byID = (id: string) => placed.find((item) => item.node.id === id)
    const selected = input.selectedNodeID?.()
    const fromSelection = selected ? byID(selected) : undefined
    const attention =
      fromSelection ??
      ["input_needed", "failed", "needs_review", "running"]
        .map((status) => placed.find((item) => item.node.status === status && item.node.kind !== "join"))
        .find(Boolean) ??
      byID(input.graph().rootID)
    if (!attention) return undefined
    return { x: attention.x, y: attention.y, width: attention.width, height: attention.height }
  })

  function fit() {
    if (!measured()) return
    adjusted = false
    // The explicit button means "show me everything", readable or not; the
    // floor applies to automatic framing only.
    setViewport(fitGraphViewport(layout().bounds, size()))
  }

  /** What lies beyond each canvas edge right now, for the indicator chips. */
  const offscreen = createMemo(() =>
    offscreenGraphSummary(
      layout().nodes
        .filter((item) => item.node.kind !== "sentinel")
        .map((item) => ({
          box: { x: item.x, y: item.y, width: item.width, height: item.height },
          attention:
            item.node.status === "input_needed" ||
            item.node.status === "failed" ||
            item.node.status === "needs_review",
        })),
      viewport(),
      size(),
    ),
  )

  /** Pans one screenful toward the pressed edge's hidden work. */
  function panToward(edge: "left" | "right" | "up" | "down") {
    const step = { width: size().width * 0.6, height: size().height * 0.6 }
    if (edge === "left") pan(step.width, 0)
    if (edge === "right") pan(-step.width, 0)
    if (edge === "up") pan(0, step.height)
    if (edge === "down") pan(0, -step.height)
  }

  /** Every user-driven move lands inside the bounded world; see the clamp. */
  const bounded = (next: ReturnType<typeof panGraphViewport>) =>
    clampGraphViewportPan(next, layout().bounds, size())

  function zoomBy(factor: number) {
    if (!measured()) return
    adjusted = true
    setViewport((current) => bounded(zoomGraphViewportCenter(current, size(), factor)))
  }

  function pan(dx: number, dy: number) {
    adjusted = true
    setViewport((current) => bounded(panGraphViewport(current, dx, dy)))
  }

  /** Brings a node into view without changing zoom; a visible node is left alone. */
  function reveal(nodeID: string) {
    const placed = sessionGraphLayoutNode(layout(), nodeID)
    if (!placed || !measured()) return
    const box = { x: placed.x, y: placed.y, width: placed.width, height: placed.height }
    if (graphNodeVisible(viewport(), box, size())) return
    adjusted = true
    setViewport((current) => bounded(centerGraphViewport(current, box, size())))
  }

  // Re-frame when the identity or shape of the graph or the pane changes,
  // never on a status update. Switching to another workflow also hands the
  // viewport back: a pan made on the previous graph must not frame this one.
  let framedRootID = ""
  createEffect(
    on(
      () => `${structure()}:${size().width}x${size().height}`,
      () => {
        const rootID = input.graph().rootID
        if (rootID !== framedRootID) {
          framedRootID = rootID
          adjusted = false
        }
        if (adjusted || !measured()) return
        // Automatic framing keeps cards readable: whole graph when it fits at
        // the floor, else centred on what matters most, with the offscreen
        // indicators pointing at the rest.
        setViewport(frameGraphViewport(layout().bounds, size(), focusBox()))
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
        bounded(
          zoomGraphViewportAt(
            current,
            { x: event.clientX - box.left, y: event.clientY - box.top },
            wheelZoomFactor(event.deltaY),
          ),
        ),
      )
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    onCleanup(() => element.removeEventListener("wheel", onWheel))
  })

  /** Drag anywhere on the background pans. Nodes stop the event themselves. */
  function startPan(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (event.button !== 0 && event.button !== 1) return
    // A press on a control is a click in progress, not the start of a pan.
    // Without this, capturing the pointer steals the click from any control
    // drawn inside the canvas (gate actions, the topology Retry) the moment
    // the pointer drifts a pixel. Node cards also stop propagation
    // themselves; this is the boundary for everything else.
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, textarea, select, [role='button'], [data-graph-interactive]")
    )
      return
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

  /** See spatialGraphNeighbor - pure and shared so it can be tested directly. */
  function neighborNodeID(fromID: string, key: string): string {
    return spatialGraphNeighbor(layout().nodes, fromID, key)
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
    /** Every edge arriving at a node, for its own hover and focus detail. */
    incomingEdges: (nodeID: string) => parentEdges().get(nodeID) ?? [],
    neighborNodeID,
    offscreen,
    panToward,
    zoomPercent: () => Math.round(clampGraphScale(viewport().scale) * 100),
    zoomIn: () => zoomBy(GRAPH_ZOOM_STEP),
    zoomOut: () => zoomBy(1 / GRAPH_ZOOM_STEP),
    fit,
    reveal,
    startPan,
    handleKeyDown,
  }
}
