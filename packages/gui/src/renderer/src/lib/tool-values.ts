export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(formatToolValue).join(", ")
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

export function fileBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function pluralize(noun: string, count: number) {
  if (count === 1) return noun
  return /(?:s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`
}

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function collapseWhitespace(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim()
  // The ellipsis counts toward the budget, so a truncated value is exactly
  // `max` visible characters - the same contract as the TUI's truncateViewText.
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
