import type { SessionGraphBounds } from "./session-graph-layout"
import { paddedBounds } from "./session-graph-layout"

/**
 * Pan and zoom state for the graph canvas.
 *
 * The canvas is a plain `<svg>` sized to its container, and this is the
 * transform applied to the single `<g>` inside it: graph coordinates map to
 * client pixels through `point * scale + offset`. Keeping that one equation
 * here means cursor-anchored zoom, drag panning and fit-to-view can not drift
 * apart, and all three are testable without a DOM.
 */

export type SessionGraphViewport = { x: number; y: number; scale: number }
export type SessionGraphPoint = { x: number; y: number }
export type SessionGraphSize = { width: number; height: number }

export const GRAPH_MIN_SCALE = 0.25
export const GRAPH_MAX_SCALE = 2.5
/** One notch of the zoom buttons; the wheel derives its factor from delta. */
export const GRAPH_ZOOM_STEP = 1.2
export const IDENTITY_VIEWPORT: SessionGraphViewport = { x: 0, y: 0, scale: 1 }

export function clampGraphScale(scale: number) {
  if (!Number.isFinite(scale)) return 1
  return Math.min(GRAPH_MAX_SCALE, Math.max(GRAPH_MIN_SCALE, scale))
}

/**
 * CSS transform for the scene layer. The scene is a positioned `div`, not an
 * SVG group, so this is CSS syntax (units, commas) rather than SVG syntax, and
 * it must be paired with `transform-origin: 0 0` for the equation above to hold.
 */
export function graphTransform(viewport: SessionGraphViewport) {
  return `translate(${round(viewport.x)}px, ${round(viewport.y)}px) scale(${round(viewport.scale, 4)})`
}

export function graphPointFromClient(viewport: SessionGraphViewport, point: SessionGraphPoint): SessionGraphPoint {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale }
}

export function clientPointFromGraph(viewport: SessionGraphViewport, point: SessionGraphPoint): SessionGraphPoint {
  return { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y }
}

export function panGraphViewport(viewport: SessionGraphViewport, dx: number, dy: number): SessionGraphViewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy }
}

/**
 * Zooms about a fixed client point, so whatever is under the pointer stays
 * under it. Clamping happens before the offset is solved, otherwise a zoom
 * that hits the limit would still slide the canvas.
 */
export function zoomGraphViewportAt(
  viewport: SessionGraphViewport,
  focus: SessionGraphPoint,
  factor: number,
): SessionGraphViewport {
  const scale = clampGraphScale(viewport.scale * factor)
  if (scale === viewport.scale) return viewport
  const anchor = graphPointFromClient(viewport, focus)
  return { x: focus.x - anchor.x * scale, y: focus.y - anchor.y * scale, scale }
}

export function zoomGraphViewportCenter(
  viewport: SessionGraphViewport,
  size: SessionGraphSize,
  factor: number,
): SessionGraphViewport {
  return zoomGraphViewportAt(viewport, { x: size.width / 2, y: size.height / 2 }, factor)
}

/**
 * Wheel notches vary wildly between mice, trackpads and platforms, so the
 * delta only chooses a direction and a bounded magnitude rather than scaling
 * the zoom directly.
 */
export function wheelZoomFactor(deltaY: number) {
  if (deltaY === 0) return 1
  const magnitude = Math.min(Math.abs(deltaY) / 100, 1)
  const step = 1 + magnitude * (GRAPH_ZOOM_STEP - 1)
  return deltaY < 0 ? step : 1 / step
}

/**
 * Below this scale a card's text stops being readable, and the graph starts
 * satisfying "show the topology" while failing "show what the model is
 * doing". Automatic framing never goes under it; manual zoom still may.
 */
export const READABLE_GRAPH_SCALE = 0.65

/**
 * Frames the graph in the viewport. Small graphs are never blown up past 1:1 -
 * a two-node workflow filling the pane looks broken rather than zoomed.
 */
export function fitGraphViewport(bounds: SessionGraphBounds, size: SessionGraphSize): SessionGraphViewport {
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) return IDENTITY_VIEWPORT
  const padded = paddedBounds(bounds)
  const scale = clampGraphScale(Math.min(1, Math.min(size.width / padded.width, size.height / padded.height)))
  return {
    x: (size.width - padded.width * scale) / 2 - padded.x * scale,
    y: (size.height - padded.height * scale) / 2 - padded.y * scale,
    scale,
  }
}

/**
 * Automatic framing with a readability floor: fit the whole graph when that
 * stays legible, otherwise hold the floor scale and centre the most relevant
 * box (selected node, attention node, or the root) - panning reaches the
 * rest, and the offscreen indicators say it exists.
 */
export function frameGraphViewport(
  bounds: SessionGraphBounds,
  size: SessionGraphSize,
  focus?: SessionGraphBounds,
): SessionGraphViewport {
  const fitted = fitGraphViewport(bounds, size)
  if (fitted.scale >= READABLE_GRAPH_SCALE) return fitted
  const target = focus ?? bounds
  return centerGraphViewport({ x: 0, y: 0, scale: READABLE_GRAPH_SCALE }, target, size)
}

/**
 * What lies *entirely* outside the visible area, by canvas edge. A card that
 * is even partially on screen is not "more work over there" - counting it
 * made the numbers read wrong at every zoom where cards straddle the edges.
 * Attention states are counted separately so the indicator can say
 * "something needs you" rather than merely "more exists". A node beyond two
 * edges at once counts toward the horizontal one - the graph reads left to
 * right, so that is the direction a reader will pan first.
 */
export function offscreenGraphSummary(
  nodes: readonly { box: SessionGraphBounds; attention: boolean }[],
  viewport: SessionGraphViewport,
  size: SessionGraphSize,
): Record<"left" | "right" | "up" | "down", { count: number; attention: number }> {
  const summary = {
    left: { count: 0, attention: 0 },
    right: { count: 0, attention: 0 },
    up: { count: 0, attention: 0 },
    down: { count: 0, attention: 0 },
  }
  for (const node of nodes) {
    const topLeft = clientPointFromGraph(viewport, { x: node.box.x, y: node.box.y })
    const bottomRight = clientPointFromGraph(viewport, {
      x: node.box.x + node.box.width,
      y: node.box.y + node.box.height,
    })
    const edge =
      bottomRight.x < 0
        ? "left"
        : topLeft.x > size.width
          ? "right"
          : bottomRight.y < 0
            ? "up"
            : topLeft.y > size.height
              ? "down"
              : undefined
    if (!edge) continue
    summary[edge].count += 1
    if (node.attention) summary[edge].attention += 1
  }
  return summary
}

/**
 * Keeps panning inside a world twice the graph's size, centred on it: half a
 * graph of margin on every side is room to breathe, while "drag the whole
 * workflow into the void and stare at dots" stops being reachable. When the
 * visible window outsizes that world on an axis, the graph centres on it
 * instead - fully zoomed out there is nowhere sensible to pan anyway.
 */
export function clampGraphViewportPan(
  viewport: SessionGraphViewport,
  bounds: SessionGraphBounds,
  size: SessionGraphSize,
): SessionGraphViewport {
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) return viewport
  const world = {
    x: bounds.x - bounds.width / 2,
    y: bounds.y - bounds.height / 2,
    width: bounds.width * 2,
    height: bounds.height * 2,
  }
  const scale = viewport.scale
  const windowWidth = size.width / scale
  const windowHeight = size.height / scale
  // The visible window in graph coordinates; clamping it clamps the pan.
  const windowX = -viewport.x / scale
  const windowY = -viewport.y / scale
  const clampAxis = (position: number, windowSpan: number, worldStart: number, worldSpan: number) => {
    if (windowSpan >= worldSpan) return worldStart + (worldSpan - windowSpan) / 2
    return Math.min(Math.max(position, worldStart), worldStart + worldSpan - windowSpan)
  }
  const clampedX = clampAxis(windowX, windowWidth, world.x, world.width)
  const clampedY = clampAxis(windowY, windowHeight, world.y, world.height)
  if (clampedX === windowX && clampedY === windowY) return viewport
  return { x: -clampedX * scale, y: -clampedY * scale, scale }
}

/** Centres one node without changing zoom, for "reveal the selected node". */
export function centerGraphViewport(
  viewport: SessionGraphViewport,
  target: SessionGraphBounds,
  size: SessionGraphSize,
): SessionGraphViewport {
  return {
    ...viewport,
    x: size.width / 2 - (target.x + target.width / 2) * viewport.scale,
    y: size.height / 2 - (target.y + target.height / 2) * viewport.scale,
  }
}

/** Whether a node's box is inside the visible area, used before auto-centring. */
export function graphNodeVisible(
  viewport: SessionGraphViewport,
  target: SessionGraphBounds,
  size: SessionGraphSize,
) {
  const topLeft = clientPointFromGraph(viewport, { x: target.x, y: target.y })
  const bottomRight = clientPointFromGraph(viewport, {
    x: target.x + target.width,
    y: target.y + target.height,
  })
  return topLeft.x >= 0 && topLeft.y >= 0 && bottomRight.x <= size.width && bottomRight.y <= size.height
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}
