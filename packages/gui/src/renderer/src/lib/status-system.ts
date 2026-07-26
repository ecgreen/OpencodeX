/**
 * The canonical status vocabulary for the whole product.
 *
 * Every surface that shows session, agent, runtime, or tool state resolves it
 * here: one tone, one glyph, one label. Status is never communicated by color
 * alone, so each entry carries a glyph and a readable label as well.
 *
 * Adding a status means adding it to this table, not to a component.
 */

export type StatusTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger" | "special"

export type StatusPresentation = {
  /** Semantic color token family. */
  tone: StatusTone
  /** Icon name from components/icon.tsx. */
  glyph: string
  /** Sentence-case label used when a surface does not supply its own. */
  label: string
  /** Condensed label for narrow surfaces such as rail rows. Defaults to `label`. */
  short?: string
  /** Genuine ongoing activity animates its dot. Nothing else does. */
  active?: boolean
}

const UNKNOWN: StatusPresentation = { tone: "neutral", glyph: "circle", label: "Unknown" }

const STATUS: Record<string, StatusPresentation> = {
  // Session lifecycle (see lib/session-status.ts for how these are derived).
  "in-progress": { tone: "info", glyph: "activity", label: "Running", active: true },
  running: { tone: "info", glyph: "activity", label: "Running", active: true },
  busy: { tone: "info", glyph: "activity", label: "Running", active: true },
  streaming: { tone: "info", glyph: "activity", label: "Streaming", active: true },
  "input-needed": { tone: "warning", glyph: "help", label: "Needs input", short: "Input" },
  blocked: { tone: "warning", glyph: "lock", label: "Blocked" },
  "ready-for-review": { tone: "success", glyph: "squareCheck", label: "Ready for review", short: "Review" },
  "needs-review": { tone: "success", glyph: "squareCheck", label: "Ready for review", short: "Review" },
  dormant: { tone: "neutral", glyph: "circle", label: "Idle" },
  idle: { tone: "neutral", glyph: "circle", label: "Idle" },
  queued: { tone: "neutral", glyph: "circle", label: "Queued" },
  pending: { tone: "neutral", glyph: "circle", label: "Pending" },
  retry: { tone: "warning", glyph: "refresh", label: "Retrying", active: true },

  // Terminal outcomes.
  completed: { tone: "success", glyph: "check", label: "Completed" },
  done: { tone: "success", glyph: "check", label: "Done" },
  success: { tone: "success", glyph: "check", label: "Success" },
  installed: { tone: "success", glyph: "check", label: "Installed" },
  failed: { tone: "danger", glyph: "warning", label: "Failed" },
  error: { tone: "danger", glyph: "warning", label: "Error" },
  interrupted: { tone: "warning", glyph: "stop", label: "Interrupted" },
  stopped: { tone: "neutral", glyph: "stop", label: "Stopped" },
  cancelled: { tone: "neutral", glyph: "stop", label: "Cancelled" },

  // Connection and runtime.
  starting: { tone: "info", glyph: "activity", label: "Starting", active: true },
  installing: { tone: "info", glyph: "activity", label: "Installing", active: true },
  connected: { tone: "success", glyph: "check", label: "Connected" },
  disconnected: { tone: "danger", glyph: "warning", label: "Disconnected" },
  "missing-cli": { tone: "warning", glyph: "warning", label: "Not installed", short: "Missing" },
  "not-installed": { tone: "warning", glyph: "warning", label: "Not installed", short: "Missing" },

  // Informational chips.
  info: { tone: "info", glyph: "circle", label: "Info" },
  warning: { tone: "warning", glyph: "warning", label: "Warning" },
  danger: { tone: "danger", glyph: "warning", label: "Danger" },
  neutral: UNKNOWN,
}

/** Normalizes the many spellings in flight (`input_needed`, `Input Needed`, `INPUT-NEEDED`). */
export function normalizeStatus(status: string) {
  return status.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")
}

/** Resolves any status string to its presentation. Unknown statuses read as neutral. */
export function statusPresentation(status: string): StatusPresentation {
  return STATUS[normalizeStatus(status)] ?? UNKNOWN
}

export function statusTone(status: string): StatusTone {
  return statusPresentation(status).tone
}

export function statusLabel(status: string): string {
  return statusPresentation(status).label
}

/** Condensed label for narrow surfaces. Falls back to the full label. */
export function statusShortLabel(status: string): string {
  const presentation = statusPresentation(status)
  return presentation.short ?? presentation.label
}

export function statusGlyph(status: string): string {
  return statusPresentation(status).glyph
}

/** True while the status represents work actually in flight. */
export function statusIsActive(status: string): boolean {
  return statusPresentation(status).active === true
}

/** Every status key this table knows, for the component lab and tests. */
export function knownStatuses(): string[] {
  return Object.keys(STATUS)
}

/**
 * Agent mode colors, matching the TUI's mode chips so a mode reads the same in
 * both clients: build is informational, plan carries the primary accent, goal
 * is the special hue.
 */
const VARIANT_TONES: Record<string, StatusTone> = {
  build: "info",
  plan: "accent",
  goal: "special",
  review: "success",
  chat: "neutral",
  general: "neutral",
}

export function variantTone(variant: string): StatusTone {
  return VARIANT_TONES[normalizeStatus(variant)] ?? "neutral"
}

/** Every agent mode this table knows, for the component lab and tests. */
export function knownVariants(): string[] {
  return Object.keys(VARIANT_TONES)
}
