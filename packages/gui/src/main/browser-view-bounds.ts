export type BrowserViewBounds = { x: number; y: number; width: number; height: number }

/** Renderer rectangles are CSS pixels; Electron child views use unzoomed window coordinates. */
export function browserViewBoundsForZoom(input: BrowserViewBounds, zoomFactor: number) {
  const factor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const x = Math.ceil(input.x * factor)
  const y = Math.ceil(input.y * factor)
  return {
    x,
    y,
    width: Math.max(1, Math.floor((input.x + input.width) * factor) - x),
    height: Math.max(1, Math.floor((input.y + input.height) * factor) - y),
  }
}
