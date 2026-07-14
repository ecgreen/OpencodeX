import { RGBA, type TerminalColors } from "@opentui/core"
import { ansiToRgba } from "./resolve"
import type { ThemeJson } from "./types"

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * alpha) * 255),
    Math.round((base.g + (overlay.g - base.g) * alpha) * 255),
    Math.round((base.b + (overlay.b - base.b) * alpha) * 255),
  )
}

export function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
  const transparent = RGBA.fromValues(bg.r, bg.g, bg.b, 0)
  const isDark = mode === "dark"
  const col = (index: number) => colors.palette[index] ? RGBA.fromHex(colors.palette[index]!) : ansiToRgba(index)
  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)
  const ansiColors = {
    black: col(0),
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    white: col(7),
    redBright: col(9),
    greenBright: col(10),
  }
  const diffAlpha = isDark ? 0.22 : 0.14
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
  const diffContextBg = grays[2]

  return {
    theme: {
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg,
      diffLineNumber: textMuted,
      diffAddedLineNumberBg: tint(diffContextBg, ansiColors.green, diffAlpha),
      diffRemovedLineNumberBg: tint(diffContextBg, ansiColors.red, diffAlpha),
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12
    const channels = grayScaleChannels({ bgR, bgG, bgB, luminance, factor, isDark })
    grays[i] = RGBA.fromInts(Math.floor(channels.r), Math.floor(channels.g), Math.floor(channels.b))
  }
  return grays
}

function grayScaleChannels(input: { bgR: number; bgG: number; bgB: number; luminance: number; factor: number; isDark: boolean }) {
  if (input.isDark && input.luminance < 10) {
    const value = Math.floor(input.factor * 0.4 * 255)
    return { r: value, g: value, b: value }
  }
  if (input.isDark) {
    const ratio = (input.luminance + (255 - input.luminance) * input.factor * 0.4) / input.luminance
    return {
      r: Math.min(input.bgR * ratio, 255),
      g: Math.min(input.bgG * ratio, 255),
      b: Math.min(input.bgB * ratio, 255),
    }
  }
  if (input.luminance > 245) {
    const value = Math.floor(255 - input.factor * 0.4 * 255)
    return { r: value, g: value, b: value }
  }
  const ratio = (input.luminance * (1 - input.factor * 0.4)) / input.luminance
  return {
    r: Math.max(input.bgR * ratio, 0),
    g: Math.max(input.bgG * ratio, 0),
    b: Math.max(input.bgB * ratio, 0),
  }
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const luminance = 0.299 * bg.r * 255 + 0.587 * bg.g * 255 + 0.114 * bg.b * 255
  const gray = isDark
    ? luminance < 10 ? 180 : Math.min(Math.floor(160 + luminance * 0.3), 200)
    : luminance > 245 ? 75 : Math.max(Math.floor(100 - (255 - luminance) * 0.2), 60)
  return RGBA.fromInts(gray, gray, gray)
}
