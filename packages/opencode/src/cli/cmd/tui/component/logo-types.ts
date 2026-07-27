import { MouseButton, RGBA } from "@opentui/core"
import type { useTheme } from "@tui/context/theme"

export type LogoShape = {
  left: string[]
  right: string[]
}

export type ShimmerConfig = {
  period: number
  rings: number
  sweepFraction: number
  coreWidth: number
  coreAmp: number
  softWidth: number
  softAmp: number
  tail: number
  tailAmp: number
  haloWidth: number
  haloOffset: number
  haloAmp: number
  breathBase: number
  noise: number
  ambientAmp: number
  ambientCenter: number
  ambientWidth: number
  shadowMix: number
  primaryMix: number
  originX: number
  originY: number
}

export type Ring = { x: number; y: number; at: number; force: number; kick: number }
export type Hold = { x: number; y: number; at: number; glyph: number | undefined }
export type Release = { x: number; y: number; at: number; glyph: number | undefined; level: number; rise: number }
export type Glow = { glyph: number; at: number; force: number }
export type Frame = {
  t: number
  list: Ring[]
  hold: Hold | undefined
  release: Release | undefined
  glow: Glow | undefined
  spark: number
}
export type Trace = { glyph: number; i: number; l: number }
export type IdleState = {
  cfg: ShimmerConfig
  reach: number
  rings: number
  active: Array<{ head: number; eased: number; ambient: number }>
}
export type LogoTheme = ReturnType<typeof useTheme>["theme"]

export const shimmerConfig: ShimmerConfig = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  softWidth: 10,
  softAmp: 1.6,
  tail: 5,
  tailAmp: 0.64,
  haloWidth: 4.3,
  haloOffset: 0.6,
  haloAmp: 0.16,
  breathBase: 0.04,
  noise: 0.1,
  ambientAmp: 0.36,
  ambientCenter: 0.5,
  ambientWidth: 0.34,
  shadowMix: 0.1,
  primaryMix: 0.3,
  originX: 4.5,
  originY: 13.5,
}

export const LOGO_GAP = 1
export const LOGO_WIDTH = 0.76
export const LOGO_GAIN = 2.3
export const LOGO_FLASH = 2.15
export const LOGO_TRAIL = 0.28
export const LOGO_SWELL = 0.24
export const LOGO_WIDE = 1.85
export const LOGO_DRIFT = 1.45
export const LOGO_EXPAND = 1.62
export const LOGO_LIFE = 1020
export const LOGO_CHARGE = 3000
export const LOGO_HOLD = 90
export const LOGO_SINK = 40
export const LOGO_ARC = 2.2
export const LOGO_FORK = 1.2
export const LOGO_DIM = 1.04
export const LOGO_KICK = 0.86
export const LOGO_LAG = 60
export const LOGO_SUCK = 0.34
export const LOGO_SHIMMER_IN = 60
export const LOGO_SHIMMER_OUT = 2.8
export const LOGO_TRACE = 0.033
export const LOGO_TAIL = 1.8
export const LOGO_TRACE_IN = 200
export const LOGO_GLOW_OUT = 1600
export const LOGO_PEAK = RGBA.fromInts(255, 255, 255)
export const LOGO_LEFT_MOUSE_BUTTON: number = MouseButton.LEFT

export const LOGO_NEAR = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const
