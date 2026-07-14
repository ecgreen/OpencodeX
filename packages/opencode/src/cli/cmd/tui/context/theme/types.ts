import type { RGBA } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

export type Theme = TuiThemeCurrent & {
  _hasSelectedListItemText: boolean
}

export type ThemeColor = Exclude<keyof TuiThemeCurrent, "thinkingOpacity">
export type SyntaxStyleOverrides = Record<string, { italic?: boolean }>
export type HexColor = `#${string}`
export type RefName = string
export type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
export type ColorValue = HexColor | RefName | Variant | RGBA

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<ThemeColor, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}
