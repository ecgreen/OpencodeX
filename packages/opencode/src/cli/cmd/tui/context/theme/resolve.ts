import { RGBA } from "@opentui/core"
import type { ColorValue, Theme, ThemeColor, ThemeJson } from "./types"

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  if (theme._hasSelectedListItemText) return theme.selectedListItemText
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const luminance = 0.299 * targetColor.r + 0.587 * targetColor.g + 0.114 * targetColor.b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }
  return theme.background
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(color: ColorValue, chain: string[] = []): RGBA {
    if (color instanceof RGBA) return color
    if (typeof color === "string") {
      if (color === "transparent" || color === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (color.startsWith("#")) return RGBA.fromHex(color)
      if (chain.includes(color)) throw new Error(`Circular color reference: ${[...chain, color].join(" -> ")}`)
      const next = defs[color] ?? theme.theme[color as ThemeColor]
      if (next === undefined) throw new Error(`Color reference "${color}" not found in defs or theme`)
      return resolveColor(next, [...chain, color])
    }
    if (typeof color === "number") return ansiToRgba(color)
    return resolveColor(color[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<Record<ThemeColor, RGBA>>
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  resolved.selectedListItemText = hasSelectedListItemText
    ? resolveColor(theme.theme.selectedListItemText!)
    : resolved.background
  resolved.backgroundMenu = theme.theme.backgroundMenu !== undefined
    ? resolveColor(theme.theme.backgroundMenu)
    : resolved.backgroundElement
  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  } as Theme
}

export function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    return RGBA.fromHex([
      "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ][code] ?? "#000000")
  }
  if (code < 232) {
    const index = code - 16
    const value = (part: number) => part === 0 ? 0 : part * 40 + 55
    return RGBA.fromInts(value(Math.floor(index / 36)), value(Math.floor(index / 6) % 6), value(index % 6))
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }
  return RGBA.fromInts(0, 0, 0)
}
