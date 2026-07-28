export const TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD = 200
export const TRANSCRIPT_USER_SCROLL_RELEASE_MS = 700

export type TranscriptScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type TranscriptFollowState = {
  followBottom: boolean
  releasedUntil: number
}

export type TranscriptLoadMoreAnchorMetrics = {
  anchorTop: number
  nextAnchorTop?: number
  scrollTop: number
  scrollHeight: number
  nextScrollHeight: number
}

export type TranscriptOpenBottomScrollState = {
  loading: boolean
  hasContent: boolean
}

export type TranscriptLoadingSkeletonState = TranscriptOpenBottomScrollState & {
  visible: boolean
  forceBottomScroll: boolean
}

export type TranscriptLoadingSkeletonDecision = "show" | "wait_for_bottom_scroll" | "hide"

export function transcriptBottomDistance(metrics: TranscriptScrollMetrics) {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop)
}

export function isTranscriptNearBottom(metrics: TranscriptScrollMetrics, threshold = TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD) {
  return transcriptBottomDistance(metrics) <= threshold
}

export function transcriptBottomScrollTop(metrics: Pick<TranscriptScrollMetrics, "scrollHeight">) {
  return metrics.scrollHeight
}

export type TranscriptViewportShiftMetrics = TranscriptScrollMetrics & {
  previousClientHeight: number
}

// When the viewport itself changes height (composer grows, safety dock appears)
// the reader should keep seeing the same content. Anchoring the distance from
// the bottom keeps the line just above the composer stable, which is where the
// eye rests in a bottom-fed transcript.
export function transcriptViewportShiftScrollTop(metrics: TranscriptViewportShiftMetrics) {
  const shifted = metrics.scrollTop + metrics.previousClientHeight - metrics.clientHeight
  return Math.max(0, Math.min(shifted, Math.max(0, metrics.scrollHeight - metrics.clientHeight)))
}

export function transcriptFollowStateAfterUserInput(now = Date.now()): TranscriptFollowState {
  return { followBottom: false, releasedUntil: now + TRANSCRIPT_USER_SCROLL_RELEASE_MS }
}

export function transcriptFollowStateAfterScroll(
  current: TranscriptFollowState,
  metrics: TranscriptScrollMetrics,
  now = Date.now(),
  threshold = TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD,
): TranscriptFollowState {
  if (!isTranscriptNearBottom(metrics, threshold)) return { followBottom: false, releasedUntil: current.releasedUntil > now ? current.releasedUntil : 0 }
  if (now < current.releasedUntil) return { followBottom: false, releasedUntil: current.releasedUntil }
  return { followBottom: true, releasedUntil: 0 }
}

export function transcriptLoadMoreScrollTop(input: TranscriptLoadMoreAnchorMetrics) {
  if (input.nextAnchorTop !== undefined) return input.scrollTop + input.nextAnchorTop - input.anchorTop
  return input.scrollTop + input.nextScrollHeight - input.scrollHeight
}

export function transcriptNewMessageCount(messageIDs: string[], lastSeenMessageID: string) {
  if (!lastSeenMessageID) return 0
  const index = messageIDs.indexOf(lastSeenMessageID)
  return index < 0 ? 0 : messageIDs.length - index - 1
}

export function shouldSpendTranscriptOpenBottomScroll(input: TranscriptOpenBottomScrollState) {
  return !input.loading && input.hasContent
}

export function transcriptLoadingSkeletonDecision(input: TranscriptLoadingSkeletonState): TranscriptLoadingSkeletonDecision {
  if (input.loading) return "show"
  if (!input.visible) return "hide"
  if (input.forceBottomScroll && shouldSpendTranscriptOpenBottomScroll(input)) return "wait_for_bottom_scroll"
  return "hide"
}
