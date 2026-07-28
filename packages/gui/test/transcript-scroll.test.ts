import { describe, expect, test } from "bun:test"
import {
  TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD,
  TRANSCRIPT_USER_SCROLL_RELEASE_MS,
  isTranscriptNearBottom,
  transcriptBottomDistance,
  transcriptBottomScrollTop,
  transcriptFollowStateAfterScroll,
  transcriptFollowStateAfterUserInput,
  transcriptLoadingSkeletonDecision,
  transcriptLoadMoreScrollTop,
  transcriptNewMessageCount,
  transcriptViewportShiftScrollTop,
  shouldSpendTranscriptOpenBottomScroll,
} from "../src/renderer/src/lib/transcript-scroll"

describe("GUI transcript scroll decisions", () => {
  test("uses a 200px near-bottom threshold", () => {
    expect(TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD).toBe(200)
    expect(transcriptBottomDistance({ scrollTop: 700, clientHeight: 100, scrollHeight: 1_000 })).toBe(200)
    expect(isTranscriptNearBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1_000 })).toBe(true)
    expect(isTranscriptNearBottom({ scrollTop: 699, clientHeight: 100, scrollHeight: 1_000 })).toBe(false)
  })

  test("user scroll input disables bottom follow", () => {
    const state = transcriptFollowStateAfterUserInput(1_000)

    expect(state).toEqual({ followBottom: false, releasedUntil: 1_000 + TRANSCRIPT_USER_SCROLL_RELEASE_MS })
    expect(transcriptFollowStateAfterScroll(state, { scrollTop: 850, clientHeight: 100, scrollHeight: 1_000 }, 1_100)).toEqual({
      followBottom: false,
      releasedUntil: 1_000 + TRANSCRIPT_USER_SCROLL_RELEASE_MS,
    })
  })

  test("manual scroll release must expire before near-bottom re-enables bottom follow", () => {
    const state = transcriptFollowStateAfterUserInput(1_000)

    expect(transcriptFollowStateAfterScroll(state, { scrollTop: 800, clientHeight: 100, scrollHeight: 1_000 }, 1_500)).toEqual({
      followBottom: false,
      releasedUntil: 1_000 + TRANSCRIPT_USER_SCROLL_RELEASE_MS,
    })
    expect(transcriptFollowStateAfterScroll(state, { scrollTop: 800, clientHeight: 100, scrollHeight: 1_000 }, 1_800)).toEqual({
      followBottom: true,
      releasedUntil: 0,
    })
  })

  test("manually reaching near bottom re-enables bottom follow after release", () => {
    const away = transcriptFollowStateAfterScroll(
      { followBottom: false, releasedUntil: 0 },
      { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 },
      2_000,
    )

    expect(away).toEqual({ followBottom: false, releasedUntil: 0 })
    expect(transcriptFollowStateAfterScroll(away, { scrollTop: 800, clientHeight: 100, scrollHeight: 1_000 }, 2_100)).toEqual({
      followBottom: true,
      releasedUntil: 0,
    })
  })

  test("resize bottom follow pins to the latest scroll height", () => {
    expect(transcriptBottomScrollTop({ scrollHeight: 1_234 })).toBe(1_234)
  })

  test("load more preserves its anchor position", () => {
    expect(transcriptLoadMoreScrollTop({
      anchorTop: 40,
      nextAnchorTop: 160,
      scrollTop: 300,
      scrollHeight: 1_000,
      nextScrollHeight: 1_400,
    })).toBe(420)
    expect(transcriptLoadMoreScrollTop({
      anchorTop: 40,
      scrollTop: 300,
      scrollHeight: 1_000,
      nextScrollHeight: 1_400,
    })).toBe(700)
  })

  test("load more can keep the previous first message in place while older content is inserted above it", () => {
    expect(transcriptLoadMoreScrollTop({
      anchorTop: 72,
      nextAnchorTop: 472,
      scrollTop: 0,
      scrollHeight: 1_000,
      nextScrollHeight: 1_400,
    })).toBe(400)
  })

  test("new message counts ignore messages prepended by load more", () => {
    expect(transcriptNewMessageCount(["m1", "m2"], "m2")).toBe(0)
    expect(transcriptNewMessageCount(["old-1", "old-2", "m1", "m2"], "m2")).toBe(0)
    expect(transcriptNewMessageCount(["old-1", "m1", "m2", "m3", "m4"], "m2")).toBe(2)
  })

  test("opening a session waits for real transcript content before spending its bottom scroll", () => {
    expect(shouldSpendTranscriptOpenBottomScroll({ loading: true, hasContent: false })).toBe(false)
    expect(shouldSpendTranscriptOpenBottomScroll({ loading: true, hasContent: true })).toBe(false)
    expect(shouldSpendTranscriptOpenBottomScroll({ loading: false, hasContent: false })).toBe(false)
    expect(shouldSpendTranscriptOpenBottomScroll({ loading: false, hasContent: true })).toBe(true)
  })

  test("loading skeleton waits for the open-session bottom scroll before hiding", () => {
    expect(transcriptLoadingSkeletonDecision({
      loading: true,
      visible: false,
      forceBottomScroll: false,
      hasContent: false,
    })).toBe("show")
    expect(transcriptLoadingSkeletonDecision({
      loading: false,
      visible: true,
      forceBottomScroll: true,
      hasContent: true,
    })).toBe("wait_for_bottom_scroll")
    expect(transcriptLoadingSkeletonDecision({
      loading: false,
      visible: true,
      forceBottomScroll: true,
      hasContent: false,
    })).toBe("hide")
    expect(transcriptLoadingSkeletonDecision({
      loading: false,
      visible: false,
      forceBottomScroll: true,
      hasContent: true,
    })).toBe("hide")
  })
})

describe("GUI transcript viewport shift compensation", () => {
  test("keeps the distance from the bottom stable when the viewport shrinks", () => {
    // Viewport lost 120px (composer grew): scrollTop must grow by 120px so the
    // line above the composer stays put.
    expect(transcriptViewportShiftScrollTop({ scrollTop: 400, scrollHeight: 2_000, clientHeight: 480, previousClientHeight: 600 })).toBe(520)
  })

  test("keeps the distance from the bottom stable when the viewport grows", () => {
    // Composer collapsed after submit: viewport gained 260px back.
    expect(transcriptViewportShiftScrollTop({ scrollTop: 700, scrollHeight: 2_000, clientHeight: 660, previousClientHeight: 400 })).toBe(440)
  })

  test("clamps to the scrollable range", () => {
    expect(transcriptViewportShiftScrollTop({ scrollTop: 10, scrollHeight: 2_000, clientHeight: 900, previousClientHeight: 400 })).toBe(0)
    expect(transcriptViewportShiftScrollTop({ scrollTop: 1_500, scrollHeight: 2_000, clientHeight: 400, previousClientHeight: 900 })).toBe(1_600)
  })

  test("degenerate content shorter than the viewport pins to the top", () => {
    expect(transcriptViewportShiftScrollTop({ scrollTop: 0, scrollHeight: 300, clientHeight: 500, previousClientHeight: 700 })).toBe(0)
  })
})
