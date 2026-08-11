export type ZoomShortcutInput = {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
}

export type ZoomAction = "in" | "out" | "reset"

/**
 * Pure so keystroke mapping is unit-testable without Electron. Needed because
 * the default menu's zoomIn role only matches a literal "+" (Shift+= on US
 * layouts), so Ctrl+= and Ctrl+NumpadAdd never zoom back in. Alt is rejected
 * because AltGr layouts report Ctrl+Alt while typing regular characters.
 */
export function zoomShortcutAction(input: ZoomShortcutInput, platform: string): ZoomAction | undefined {
  if (input.type !== "keyDown" || input.alt) return undefined
  const modifier = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta
  if (!modifier) return undefined
  if (input.key === "+" || input.key === "=" || input.code === "NumpadAdd") return "in"
  if (input.key === "-" || input.key === "_" || input.code === "NumpadSubtract") return "out"
  if (input.key === "0") return "reset"
  return undefined
}

const ZOOM_LEVEL_LIMIT = 8

export function nextZoomLevel(current: number, action: ZoomAction) {
  if (action === "reset") return 0
  const stepped = current + (action === "in" ? 0.5 : -0.5)
  return Math.min(ZOOM_LEVEL_LIMIT, Math.max(-ZOOM_LEVEL_LIMIT, stepped))
}
