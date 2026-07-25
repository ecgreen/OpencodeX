export function exitDescription(event: { exitCode?: number; signal?: number | string; message?: string }) {
  if (event.message) return `: ${event.message}`
  if (typeof event.exitCode === "number") return ` with code ${event.exitCode}`
  if (event.signal !== undefined) return ` from signal ${event.signal}`
  return ""
}

export function exitShouldRestart(event: { exitCode?: number; signal?: number | string }) {
  return event.exitCode === undefined || event.exitCode !== 0 || event.signal !== undefined
}

type ClaudeRuntimeLike = { status: string; code?: string }

/** One status vocabulary for the rail, dashboard, palette, and terminal panes. */
export function claudeStatusLabel(runtime: ClaudeRuntimeLike) {
  if (runtime.code === "desktop-required") return "Requires Desktop"
  if (runtime.status === "missing-cli") return "CLI missing"
  if (runtime.status === "wrong-device") return "Another device"
  return runtime.status.charAt(0).toUpperCase() + runtime.status.slice(1)
}

/** Whether the start/resume action applies, shared by every header and overlay. */
export function claudeCanStart(runtime: ClaudeRuntimeLike) {
  if (runtime.code === "desktop-required") return false
  return runtime.status === "idle" || runtime.status === "stopped" || runtime.status === "error" || runtime.status === "missing-cli"
}

export function claudeStartLabel(runtime: ClaudeRuntimeLike) {
  if (runtime.status === "missing-cli") return "Check again"
  if (runtime.status === "error") return "Retry"
  // A session that has never launched starts; only a stopped one resumes.
  return runtime.status === "idle" ? "Start" : "Resume"
}

export function terminalTheme() {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue(name).trim()
  const dark = style.colorScheme.includes("dark")
  return {
    background: color("--theme-canvas"), foreground: color("--theme-text"), cursor: color("--theme-accent"), cursorAccent: color("--theme-canvas"),
    selectionBackground: color("--theme-accent-soft"), selectionForeground: color("--theme-text"), selectionInactiveBackground: color("--theme-overlay-medium"),
    black: color(dark ? "--theme-text-muted" : "--theme-text"), red: color("--theme-danger"), green: color("--theme-success"), yellow: color("--theme-warning"),
    blue: color("--theme-info"), magenta: color("--theme-special"), cyan: color("--theme-syntax-type"), white: color(dark ? "--theme-text" : "--theme-text-muted"),
    brightBlack: color("--theme-text-subtle"), brightRed: color("--theme-danger"), brightGreen: color("--theme-success"), brightYellow: color("--theme-warning"),
    brightBlue: color("--theme-info"), brightMagenta: color("--theme-special"), brightCyan: color("--theme-syntax-type"), brightWhite: color("--theme-text"),
  }
}
