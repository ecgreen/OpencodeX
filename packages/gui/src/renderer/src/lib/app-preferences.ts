export type GuiThemeMode = "dark" | "light"

export function readRecentModels() {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem("opencodex.gui.recentModels")
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(0, 10)
  } catch {
    return []
  }
}

export function writeRecentModels(values: string[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.recentModels", JSON.stringify(values.slice(0, 10)))
  } catch {
    return
  }
}

export function readThemeMode(): GuiThemeMode {
  if (typeof localStorage === "undefined") return "dark"
  return localStorage.getItem("opencodex.gui.theme") === "light" ? "light" : "dark"
}

export function readBoolPreference(key: string, fallback: boolean) {
  if (typeof localStorage === "undefined") return fallback
  const value = localStorage.getItem(key)
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

export function writeBoolPreference(key: string, value: boolean) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(key, value ? "true" : "false")
}
