export type LogoRgb = { r: number; g: number; b: number }

export type LogoTheme = {
  background: LogoRgb
  primary: LogoRgb
  warning: LogoRgb
  peak: LogoRgb
  muted: LogoRgb
  text: LogoRgb
  /**
   * Colour the shimmer crest travels toward. On a dark canvas `peak` is nearly
   * white, so the crest reads as light sweeping across the wordmark. On a light
   * canvas `peak` is nearly black and that same crest turns into a dark bruise,
   * so light themes point the crest at the accent instead. Defaults to `peak`.
   */
  glow?: LogoRgb
  /**
   * Scales the ambient shadow behind the glyphs. The halo is subtle when it
   * lightens a dark canvas and heavy-handed when it darkens a light one, so
   * light themes dial it back. Defaults to 1.
   */
  shadowScale?: number
}

type LogoPointGeometry = {
  pixelY: number
  distance: number
  angle: number
  noise1: number
  noise2: number
}

export type LogoCellGeometry = {
  index: number
  char: string
  text: string
  x: number
  y: number
  ink: "muted" | "text"
  top: LogoPointGeometry
  bottom: LogoPointGeometry
  shimmerDistance: number
}

export type LogoGeometry = {
  left: number
  width: number
  height: number
  span: number
  reach: number
  corners: [number, number][]
  lines: { left: LogoCellGeometry[]; right: LogoCellGeometry[] }[]
  cells: LogoCellGeometry[]
}

export type LogoCellFrame = { color: string; backgroundColor?: string }

export const LOGO_FRAME_INTERVAL_MS = 50

const LOGO = {
  left: ["                   ", "\u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2584", "\u2588__\u2588 \u2588__\u2588 \u2588^^^ \u2588__\u2588", "\u2580\u2580\u2580\u2580 \u2588\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580~~\u2580"],
  right: ["             \u2584            ", "\u2588\u2580\u2580\u2580 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2580\u2584\u2580", "\u2588___ \u2588__\u2588 \u2588__\u2588 \u2588^^^ \u2580 \u2580 ", "\u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580    "],
} as const

const LOGO_SHIMMER = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  tail: 5,
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
} as const

export const OPENCODEX_LOGO_GEOMETRY = createLogoGeometry(LOGO.left, LOGO.right)

export function createLogoGeometry(left: readonly string[], right: readonly string[]): LogoGeometry {
  const full = left.map((line, index) => line + " " + (right[index] ?? ""))
  const width = full[0]?.length ?? 0
  const height = full.length * 2
  const corners: [number, number][] = [[0, 0], [width, 0], [0, height], [width, height]]
  const cells: LogoCellGeometry[] = []
  const leftWidth = left[0]?.length ?? 0
  const lines = left.map((line, y) => {
    const leftCells = createCells(line, y, 0, "muted", cells.length)
    cells.push(...leftCells)
    const rightCells = createCells(right[y] ?? "", y, leftWidth + 1, "text", cells.length)
    cells.push(...rightCells)
    return { left: leftCells, right: rightCells }
  })
  return {
    left: leftWidth,
    width,
    height,
    span: Math.hypot(width, height) * 0.94,
    reach: Math.max(...corners.map(([x, y]) => Math.hypot(x - LOGO_SHIMMER.originX, y - LOGO_SHIMMER.originY))) + LOGO_SHIMMER.tail * 2,
    corners,
    lines,
    cells,
  }
}

export function logoAnimationEnabled(input: { active: boolean; pageVisible: boolean; windowFocused: boolean; reducedMotion: boolean }) {
  return input.active && input.pageVisible && input.windowFocused && !input.reducedMotion
}

export function logoFrameDue(previous: number | undefined, current: number) {
  return previous === undefined || current - previous >= LOGO_FRAME_INTERVAL_MS
}

export function logoCellFrame(cell: LogoCellGeometry, time: number, geometry: LogoGeometry, theme: LogoTheme): LogoCellFrame {
  const charInk = cell.x >= 40 ? theme.warning : theme[cell.ink]
  if (cell.char === " ") return { color: rgbToCss(charInk) }

  const top = logoIdle(cell.top, time, geometry.reach)
  const bottom = logoIdle(cell.bottom, time, geometry.reach)
  const pulse = { peak: (top.peak + bottom.peak) / 2, primary: (top.primary + bottom.primary) / 2 }
  const inkTop = logoPeakTint(charInk, top, theme)
  const inkBottom = logoPeakTint(charInk, bottom, theme)
  const inkTinted = logoPeakTint(charInk, pulse, theme)
  const shadowMix = LOGO_SHIMMER.shadowMix * (theme.shadowScale ?? 1)
  const shadowTop = tint(theme.background, theme.peak, Math.min(1, top.peak * shadowMix))
  const shadowBottom = tint(theme.background, theme.peak, Math.min(1, bottom.peak * shadowMix))
  const shadowTinted = tint(theme.background, theme.peak, Math.min(1, pulse.peak * shadowMix))
  const shimmer = logoShimmer(cell.shimmerDistance, time, geometry.span)

  if (cell.char === "_") return { color: rgbToCss(inkTinted), backgroundColor: rgbToCss(shade(shadowTinted, ghost(shimmer, 0.06), theme)) }
  if (cell.char === "^") return { color: rgbToCss(inkTop), backgroundColor: rgbToCss(shade(shadowBottom, ghost(shimmer, 0.05), theme)) }
  if (cell.char === "~") return { color: rgbToCss(shade(shadowTop, ghost(shimmer, 0.05), theme)) }
  if (cell.char === ",") return { color: rgbToCss(shade(shadowBottom, ghost(shimmer, 0.05), theme)) }
  if (cell.char === "\u2588") return { color: rgbToCss(inkTop), backgroundColor: rgbToCss(inkBottom) }
  if (cell.char === "\u2580") return { color: rgbToCss(inkTop) }
  if (cell.char === "\u2584") return { color: rgbToCss(inkBottom) }
  return { color: rgbToCss(inkTinted) }
}

export function cssColorToRgb(value: string) {
  const hex = value.trim().replace("#", "")
  if (hex.length === 3) return { r: Number.parseInt(hex[0] + hex[0], 16), g: Number.parseInt(hex[1] + hex[1], 16), b: Number.parseInt(hex[2] + hex[2], 16) }
  if (hex.length >= 6) return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) }
  return { r: 0, g: 0, b: 0 }
}

function createCells(line: string, y: number, offset: number, ink: "muted" | "text", start: number) {
  return Array.from(line).map((char, index) => {
    const x = offset + index
    return {
      index: start + index,
      char,
      text: logoCellText(char),
      x,
      y,
      ink,
      top: logoPointGeometry(x, y * 2),
      bottom: logoPointGeometry(x, y * 2 + 1),
      shimmerDistance: Math.hypot(x + 0.5 - LOGO_SHIMMER.originX, y * 2 + 1 - LOGO_SHIMMER.originY),
    }
  })
}

function logoCellText(char: string) {
  if (char === "_") return " "
  if (char === "^" || char === "~" || char === "\u2588") return "\u2580"
  if (char === ",") return "\u2584"
  return char
}

function logoPointGeometry(x: number, pixelY: number): LogoPointGeometry {
  const dx = x + 0.5 - LOGO_SHIMMER.originX
  const dy = pixelY - LOGO_SHIMMER.originY
  return {
    pixelY,
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
    noise1: x * 0.32 * 12.9898 + pixelY * 0.25 * 78.233,
    noise2: x * 0.12 * 12.9898 + pixelY * 0.08 * 78.233,
  }
}

function logoIdle(point: LogoPointGeometry, time: number, reach: number) {
  const wob1 = logoNoise(point.noise1, time * 0.0005) - 0.5
  const wob2 = logoNoise(point.noise2, time * 0.00022) - 0.5
  const ripple = Math.sin(point.angle * 3 + time * 0.0012) * 0.3
  const traveled = point.distance + (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * LOGO_SHIMMER.noise
  const rings = Math.max(1, Math.floor(LOGO_SHIMMER.rings))
  const values = Array.from({ length: rings }).map((_, index) => {
    const cyclePhase = (time / LOGO_SHIMMER.period + index / rings) % 1
    if (cyclePhase >= LOGO_SHIMMER.sweepFraction) return { peak: 0, primary: 0, ambient: 0 }
    const phase = cyclePhase / LOGO_SHIMMER.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const delta = traveled - phase * reach
    const core = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.coreWidth) ** 1.8))
    const tailRange = LOGO_SHIMMER.tail * 2.6
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
    const haloBand = Math.exp(-(Math.abs((delta + LOGO_SHIMMER.haloOffset) / LOGO_SHIMMER.haloWidth) ** 1.6))
    const ambientDistance = (phase - LOGO_SHIMMER.ambientCenter) / LOGO_SHIMMER.ambientWidth
    return {
      peak: (core * LOGO_SHIMMER.coreAmp + haloBand * LOGO_SHIMMER.haloAmp) * eased,
      primary: (haloBand + tail * 0.6) * eased,
      ambient: Math.abs(ambientDistance) < 1 ? (1 - ambientDistance * ambientDistance) ** 2 * LOGO_SHIMMER.ambientAmp : 0,
    }
  })
  return {
    peak: LOGO_SHIMMER.breathBase + values.reduce((sum, item) => sum + item.ambient + item.peak, 0) / rings,
    primary: values.reduce((sum, item) => sum + item.primary, 0) / rings * LOGO_SHIMMER.primaryMix,
  }
}

function logoShimmer(distance: number, time: number, span: number) {
  const phase = (time / LOGO_SHIMMER.period) % 1
  const delta = distance - phase * (span + LOGO_SHIMMER.tail * 2)
  if (delta < -LOGO_SHIMMER.tail || delta > LOGO_SHIMMER.coreWidth) return 0
  return Math.exp(-(Math.abs(delta / LOGO_SHIMMER.haloWidth) ** 1.6)) * 0.25
}

function logoPeakTint(base: LogoRgb, pulse: { peak: number; primary: number }, theme: LogoTheme) {
  const primary = pulse.primary > 0 ? tint(base, theme.primary, Math.min(1, pulse.primary)) : base
  return pulse.peak > 0 ? tint(primary, theme.peak, Math.min(1, pulse.peak)) : primary
}

function shade(base: LogoRgb, amount: number, theme: LogoTheme) {
  if (amount >= 0) {
    const middle = tint(base, theme.primary, 0.84)
    const top = tint(theme.primary, theme.glow ?? theme.peak, 0.96)
    if (amount <= 1) return tint(base, middle, Math.min(1, Math.sqrt(Math.max(0, amount)) * 1.14))
    return tint(middle, top, Math.min(1, 1 - Math.exp(-2.4 * (amount - 1))))
  }
  return tint(base, theme.background, Math.min(0.82, -amount * 0.64))
}

function ghost(amount: number, scale: number) {
  if (amount < 0) return amount
  return amount * scale
}

function tint(a: LogoRgb, b: LogoRgb, amount: number) {
  const value = Math.max(0, Math.min(1, amount))
  return { r: a.r + (b.r - a.r) * value, g: a.g + (b.g - a.g) * value, b: a.b + (b.b - a.b) * value }
}

function logoNoise(base: number, time: number) {
  const value = Math.sin(base + time * 0.043) * 43758.5453
  return value - Math.floor(value)
}

function rgbToCss(rgb: LogoRgb) {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`
}
