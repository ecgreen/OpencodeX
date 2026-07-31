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
