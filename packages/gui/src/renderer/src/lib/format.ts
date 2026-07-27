export function formatRelative(value?: number | string) {
  if (typeof value !== "number" || Number.isNaN(value)) return "never"
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function compactPath(value?: string) {
  if (!value) return "No directory"
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean)
  if (parts.length <= 3) return value
  return `.../${parts.slice(-3).join("/")}`
}

export function title(value?: string) {
  return value?.trim() || "Untitled"
}
