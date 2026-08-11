import { Show, createContext, createMemo, useContext, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { DisclosureStore } from "../lib/disclosure"
import { useNowTicker } from "../lib/now-ticker"
import { formatElapsed, toolCategory, toolErrorSummary, type ToolCategory } from "../lib/tool-display"
import type { ToolPart } from "../lib/transcript-grouping"
import { DisclosureChevron, Icon } from "./icon"

const CATEGORY_ICON: Record<ToolCategory, string> = {
  search: "search",
  web: "globe",
  exec: "terminal",
  file: "fileDiff",
  plan: "squareCheck",
  agent: "swarm",
  generic: "code",
}

/*
 * Per-tool overrides where the category glyph misleads: a question is not a
 * todo list. Glyphs are chosen to stay legible at chip size - one shape, one
 * mark, no interior detail.
 */
const TOOL_ICON: Record<string, string> = {
  question: "help",
}

export function partIconName(tool: string) {
  return TOOL_ICON[tool] ?? CATEGORY_ICON[toolCategory(tool)]
}

type TranscriptContextValue = {
  /** False once the reader scrolls away from the tail. */
  following: () => boolean
  disclosure: () => DisclosureStore | undefined
  /** False when the session is idle - nothing can genuinely be running then. */
  live: () => boolean
}

const TranscriptContext = createContext<TranscriptContextValue>()

export const TranscriptChromeProvider = TranscriptContext.Provider

export function useTranscriptChrome(): TranscriptContextValue {
  return useContext(TranscriptContext) ?? { following: () => true, disclosure: () => undefined, live: () => true }
}

/**
 * The single header used by every transcript part. It renders a `summary` when
 * the row can expand and a `div` when it cannot, but keeps one class either
 * way so header styling is written once instead of once per element type.
 */
export function PartHeader(props: {
  static?: boolean
  icon?: string
  title: string
  meta?: JSX.Element
  status?: JSX.Element
  trailing?: JSX.Element
  subagentSessionID?: string
}) {
  return (
    <Dynamic
      component={props.static ? "div" : "summary"}
      class="part-header"
      classList={{ "part-header-static": props.static === true }}
      data-subagent-session={props.subagentSessionID}
    >
      <Show when={!props.static} fallback={<span class="part-chevron-spacer" aria-hidden="true" />}>
        <DisclosureChevron />
      </Show>
      <Show when={props.icon}>
        {(name) => <Icon name={name()} class="part-icon" />}
      </Show>
      <span class="part-title">{props.title}</span>
      <Show when={props.meta}>
        <span class="part-meta">{props.meta}</span>
      </Show>
      <Show when={props.status}>
        <span class="part-status">{props.status}</span>
      </Show>
      {props.trailing}
    </Dynamic>
  )
}

/**
 * Status has to be visible without expanding the row: a live timer while work
 * runs, a duration receipt once it lands, and the failure text when it does not.
 */
export function ToolStatusIndicator(props: { state: ToolPart["state"]; stale?: boolean }) {
  const status = () => props.state.status
  const running = () => (status() === "running" || status() === "pending") && !props.stale
  const now = useNowTicker()
  const started = createMemo(() => "time" in props.state ? props.state.time?.start : undefined)
  const elapsed = createMemo(() => {
    const start = started()
    if (start === undefined) return ""
    if (running()) return formatElapsed(Math.max(0, now() - start))
    const time = "time" in props.state ? props.state.time : undefined
    const end = time && "end" in time ? time.end : undefined
    if (typeof end !== "number") return ""
    const duration = end - start
    // Sub-two-second calls are noise; only slow work earns a receipt.
    return duration >= 2000 ? formatElapsed(duration) : ""
  })
  return (
    <>
      <Show when={running()}>
        <span class="part-spinner" aria-hidden="true" />
        <span class="part-status-label">Running</span>
      </Show>
      {/* The turn moved on without this call ever landing a result. No timer -
          there is nothing left to time. */}
      <Show when={props.stale && (status() === "running" || status() === "pending")}>
        <span class="part-status-label muted">Interrupted</span>
      </Show>
      <Show when={status() === "error"}>
        <span class="part-status-label error">Failed</span>
      </Show>
      <Show when={elapsed()}>
        {(value) => <span class="part-duration">{value()}</span>}
      </Show>
    </>
  )
}

/** One-line failure text shown on a collapsed row so errors are never silent. */
export function PartErrorPreview(props: { state: ToolPart["state"]; when: boolean }) {
  const summary = createMemo(() => toolErrorSummary(props.state))
  return (
    <Show when={props.when && summary()}>
      {(text) => <small class="part-error-preview">{text()}</small>}
    </Show>
  )
}
