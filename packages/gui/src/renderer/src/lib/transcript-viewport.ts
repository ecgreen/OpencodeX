import { transcriptBottomScrollTop, transcriptViewportShiftScrollTop } from "./transcript-scroll"

export type TranscriptViewportInput = {
  viewport: () => HTMLElement | undefined
  content: () => HTMLElement | undefined
  followBottom: () => boolean
  // True while another mechanism already owns `scrollTop` (open-session bottom
  // scroll, or the Load More anchor restore), so compensation must stand down.
  suspended: () => boolean
  update: () => void
}

// ResizeObserver callbacks run before paint, so correcting `scrollTop` here is
// invisible. Deferring it to the rAF in `update` would let the tail visibly jump
// by the composer's growth for one frame before snapping back.
export function createTranscriptViewportCompensator(input: Omit<TranscriptViewportInput, "content" | "update">) {
  let lastClientHeight = 0
  let lastScrollHeight = 0
  return () => {
    const viewport = input.viewport()
    if (!viewport) return
    const previousClientHeight = lastClientHeight
    const previousScrollHeight = lastScrollHeight
    lastClientHeight = viewport.clientHeight
    lastScrollHeight = viewport.scrollHeight
    if (input.suspended()) return
    // A follower stays glued to the tail through both kinds of geometry change:
    // the viewport resizing (composer growth) and the content resizing
    // (streaming output, messages arriving). Correcting pre-paint means the
    // reader never sees the intermediate position.
    if (input.followBottom()) {
      if (previousClientHeight !== lastClientHeight || previousScrollHeight !== lastScrollHeight) {
        viewport.scrollTop = transcriptBottomScrollTop(viewport)
      }
      return
    }
    if (previousClientHeight === lastClientHeight) return
    viewport.scrollTop = transcriptViewportShiftScrollTop({
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      previousClientHeight,
    })
  }
}

// Returns a cleanup function so the caller can hand it straight to `onCleanup`.
export function observeTranscriptScrollGeometry(input: TranscriptViewportInput) {
  const compensate = createTranscriptViewportCompensator(input)
  if (typeof ResizeObserver === "undefined") return () => {}
  const observer = new ResizeObserver(() => {
    compensate()
    input.update()
  })
  const viewport = input.viewport()
  const content = input.content()
  if (viewport) observer.observe(viewport)
  if (content) observer.observe(content)
  return () => observer.disconnect()
}
