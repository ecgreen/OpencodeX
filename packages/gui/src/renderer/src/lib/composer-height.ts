// The composer auto-grows to fit its draft, but it shares a grid with the
// transcript: every pixel it gains is a pixel the transcript viewport loses.
// Clamping the growth keeps a long prompt from swallowing the conversation.
export const COMPOSER_MIN_HEIGHT = 46
export const COMPOSER_MAX_HEIGHT = 320
export const COMPOSER_MIN_MAX_HEIGHT = 120
export const COMPOSER_MAX_VIEWPORT_RATIO = 0.4

export type ComposerHeightDecision = {
  height: number
  scrollable: boolean
}

export function composerMaxHeight(viewportHeight: number) {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return COMPOSER_MAX_HEIGHT
  const ratioHeight = Math.round(viewportHeight * COMPOSER_MAX_VIEWPORT_RATIO)
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_MAX_HEIGHT, ratioHeight))
}

// `contentHeight` is the textarea's `scrollHeight` measured while its inline
// height is released, so it reflects the full draft rather than the current box.
export function composerHeightDecision(contentHeight: number, viewportHeight: number): ComposerHeightDecision {
  const max = composerMaxHeight(viewportHeight)
  const content = Number.isFinite(contentHeight) ? contentHeight : COMPOSER_MIN_HEIGHT
  const height = Math.max(COMPOSER_MIN_HEIGHT, Math.min(content, max))
  return { height, scrollable: content > max }
}
