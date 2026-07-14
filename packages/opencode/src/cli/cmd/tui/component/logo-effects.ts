import { tint } from "@tui/context/theme"
import { logoCellKey, type LogoContext } from "./logo-geometry"
import {
  LOGO_ARC,
  LOGO_CHARGE,
  LOGO_DIM,
  LOGO_DRIFT,
  LOGO_EXPAND,
  LOGO_FLASH,
  LOGO_FORK,
  LOGO_GAIN,
  LOGO_GLOW_OUT,
  LOGO_HOLD,
  LOGO_LIFE,
  LOGO_NEAR,
  LOGO_PEAK,
  LOGO_SHIMMER_IN,
  LOGO_SHIMMER_OUT,
  LOGO_SINK,
  LOGO_SUCK,
  LOGO_SWELL,
  LOGO_TAIL,
  LOGO_TRACE,
  LOGO_TRACE_IN,
  LOGO_TRAIL,
  LOGO_WIDE,
  LOGO_WIDTH,
  shimmerConfig,
  type Frame,
  type IdleState,
  type LogoTheme,
  type Release,
} from "./logo-types"

export function clampLogoEffect(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function lerpLogoEffect(start: number, end: number, amount: number) {
  return start + (end - start) * clampLogoEffect(amount)
}

function ease(value: number) {
  const amount = clampLogoEffect(value)
  return amount * amount * (3 - 2 * amount)
}

export function pushLogoEffect(value: number) {
  const amount = clampLogoEffect(value)
  return ease(amount * amount)
}

export function rampLogoEffect(value: number, start: number, end: number) {
  if (end <= start) return ease(value >= end ? 1 : 0)
  return ease((value - start) / (end - start))
}

function glow(base: ReturnType<typeof tint>, theme: LogoTheme, amount: number) {
  const middle = tint(base, theme.primary, 0.84)
  const top = tint(theme.primary, LOGO_PEAK, 0.96)
  if (amount <= 1) return tint(base, middle, Math.min(1, Math.sqrt(Math.max(0, amount)) * 1.14))
  return tint(middle, top, Math.min(1, 1 - Math.exp(-2.4 * (amount - 1))))
}

export function shadeLogoEffect(base: ReturnType<typeof tint>, theme: LogoTheme, amount: number) {
  if (amount >= 0) return glow(base, theme, amount)
  return tint(base, theme.background, Math.min(0.82, -amount * 0.64))
}

export function ghostLogoEffect(amount: number, scale: number) {
  if (amount < 0) return amount
  return amount * scale
}

export function logoNoise(x: number, y: number, time: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + time * 0.043) * 43758.5453
  return value - Math.floor(value)
}

export function shimmerLogoEffect(x: number, y: number, frame: Frame, context: LogoContext) {
  return frame.list.reduce((best, item) => {
    const age = frame.t - item.at
    if (age < LOGO_SHIMMER_IN || age > LOGO_LIFE) return best
    const distance = Math.hypot(x + 0.5 - item.x, y * 2 + 1 - item.y)
    const progress = age / LOGO_LIFE
    const radius = context.SPAN * (1 - (1 - progress) ** LOGO_EXPAND)
    const lag = radius - distance
    if (lag < 0.18 || lag > LOGO_SHIMMER_OUT) return best
    const band = Math.exp(-(((lag - 1.05) / 0.68) ** 2))
    const wobble = 0.5 + 0.5 * Math.sin(frame.t * 0.035 + x * 0.9 + y * 1.7)
    return Math.max(best, band * wobble * (1 - progress) ** 1.45)
  }, 0)
}

function remain(x: number, y: number, item: Release, time: number, context: LogoContext) {
  const age = time - item.at
  if (age < 0 || age > LOGO_LIFE) return 0
  const progress = age / LOGO_LIFE
  const distance = Math.hypot(x - item.x, y * 2 - item.y * 2)
  const radius = context.SPAN * (1 - (1 - progress) ** LOGO_EXPAND)
  if (distance > radius) return 1
  return clampLogoEffect((radius - distance) / 1.35 < 1 ? 1 - (radius - distance) / 1.35 : 0)
}

export function waveLogoEffect(x: number, y: number, frame: Frame, live: boolean, context: LogoContext) {
  return frame.list.reduce((sum, item) => {
    const age = frame.t - item.at
    if (age < 0 || age > LOGO_LIFE) return sum
    const progress = age / LOGO_LIFE
    const distance = Math.hypot(x + 0.5 - item.x, y * 2 + 1 - item.y)
    const radius = context.SPAN * (1 - (1 - progress) ** LOGO_EXPAND)
    const fade = (1 - progress) ** 1.32
    const jitter = 1.02 + logoNoise(x + item.x * 0.7, y + item.y * 0.7, item.at * 0.002 + age * 0.06) * 0.52
    const edge = Math.exp(-(((distance - radius) / LOGO_WIDTH) ** 2)) * LOGO_GAIN * fade * item.force * jitter
    const swell =
      Math.exp(-(((distance - Math.max(0, radius - LOGO_DRIFT)) / LOGO_WIDE) ** 2)) * LOGO_SWELL * fade * item.force
    const trail =
      distance < radius
        ? Math.exp(-(radius - distance) / 2.4) * LOGO_TRAIL * fade * item.force * lerpLogoEffect(0.92, 1.22, jitter)
        : 0
    const flash =
      Math.exp(-(distance * distance) / 3.2) *
      LOGO_FLASH *
      item.force *
      Math.max(0, 1 - age / 140) *
      lerpLogoEffect(0.95, 1.18, jitter)
    const kick = Math.exp(-(distance * distance) / 2) * item.kick * Math.max(0, 1 - age / 100)
    const suck =
      Math.exp(-(((distance - 1.25) / 0.75) ** 2)) * item.kick * LOGO_SUCK * Math.max(0, 1 - age / 110)
    const wake = live && distance < radius ? Math.exp(-(radius - distance) / 1.25) * 0.32 * fade : 0
    return sum + edge + swell + trail + flash + wake - kick - suck
  }, 0)
}

export function fieldLogoEffect(x: number, y: number, frame: Frame, context: LogoContext) {
  const held = frame.hold
  const release = frame.release
  const item = held ?? release
  if (!item) return 0
  const rise = held ? rampLogoEffect(frame.t - held.at, LOGO_HOLD, LOGO_CHARGE) : release!.rise
  const level = held ? pushLogoEffect(rise) : release!.level
  const storm = level * level
  const sink = held ? rampLogoEffect(frame.t - held.at, LOGO_SINK, LOGO_CHARGE) : release!.rise
  const dx = x - item.x
  const dy = y * 2 - item.y * 2
  const distance = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const spin = frame.t * lerpLogoEffect(0.008, 0.018, storm)
  const dim = lerpLogoEffect(0, LOGO_DIM, sink) * lerpLogoEffect(0.99, 1.01, 0.5 + 0.5 * Math.sin(frame.t * 0.014))
  const core = Math.exp(-(distance * distance) / Math.max(0.22, lerpLogoEffect(0.22, 3.2, rise))) * lerpLogoEffect(0.42, 2.45, rise)
  const shell =
    Math.exp(-(((distance - lerpLogoEffect(0.16, 2.05, rise)) / Math.max(0.18, lerpLogoEffect(0.18, 0.82, rise))) ** 2)) *
    lerpLogoEffect(0.1, 0.95, rise)
  const ember =
    Math.exp(-(((distance - lerpLogoEffect(0.45, 2.65, rise)) / Math.max(0.14, lerpLogoEffect(0.14, 0.62, rise))) ** 2)) *
    lerpLogoEffect(0.02, 0.78, rise)
  const arc = Math.max(0, Math.cos(angle * 3 - spin + frame.spark * 2.2)) ** 8
  const seam = Math.max(0, Math.cos(angle * 5 + spin * 1.55)) ** 12
  const ring =
    Math.exp(-(((distance - lerpLogoEffect(1.05, 3, level)) / 0.48) ** 2)) * arc * lerpLogoEffect(0.03, 0.5 + LOGO_ARC, storm)
  const fork = Math.exp(-(((distance - (1.55 + storm * 2.1)) / 0.36) ** 2)) * seam * storm * LOGO_FORK
  const spark = Math.max(0, logoNoise(x, y, frame.t) - lerpLogoEffect(0.94, 0.66, storm)) * lerpLogoEffect(0, 5.4, storm)
  const glitch = spark * Math.exp(-distance / Math.max(1.2, 3.1 - storm))
  const crack = Math.max(0, Math.cos((dx - dy) * 1.6 + spin * 2.1)) ** 18
  const lash = crack * Math.exp(-(((distance - (1.95 + storm * 2)) / 0.28) ** 2)) * storm * 1.1
  const flicker =
    Math.max(0, logoNoise(item.x * 3.1, item.y * 2.7, frame.t * 1.7) - 0.72) *
    Math.exp(-(distance * distance) / 0.15) *
    lerpLogoEffect(0.08, 0.42, rise)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, context) : 1
  return (core + shell + ember + ring + fork + glitch + lash + flicker - dim) * fade
}

export function pickLogoEffect(x: number, y: number, frame: Frame, context: LogoContext) {
  const held = frame.hold
  const release = frame.release
  const item = held ?? release
  if (!item) return 0
  const rise = held ? rampLogoEffect(frame.t - held.at, LOGO_HOLD, LOGO_CHARGE) : release!.rise
  const distance = Math.hypot(x - item.x, y * 2 - item.y * 2)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, context) : 1
  return Math.exp(-(distance * distance) / 1.7) * lerpLogoEffect(0.2, 0.96, rise) * fade
}

export function traceLogoEffect(x: number, y: number, frame: Frame, context: LogoContext) {
  const held = frame.hold
  const release = frame.release
  const item = held ?? release
  if (!item || item.glyph === undefined) return 0
  const step = context.MAP.trace.get(logoCellKey(x, y))
  if (!step || step.glyph !== item.glyph || step.l < 2) return 0
  const age = frame.t - item.at
  const rise = held ? rampLogoEffect(age, LOGO_HOLD, LOGO_CHARGE) : release!.rise
  const appear = held ? rampLogoEffect(age, 0, LOGO_TRACE_IN) : 1
  const head = (age * lerpLogoEffect(LOGO_TRACE * 0.48, LOGO_TRACE * 0.88, rise)) % step.l
  const distance = Math.min(Math.abs(step.i - head), step.l - Math.abs(step.i - head))
  const tail = (head - LOGO_TAIL + step.l) % step.l
  const lag = Math.min(Math.abs(step.i - tail), step.l - Math.abs(step.i - tail))
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, context) : 1
  const core = Math.exp(-((distance / 1.05) ** 2)) * lerpLogoEffect(0.8, 2.35, rise)
  const glow = Math.exp(-((distance / 1.85) ** 2)) * lerpLogoEffect(0.08, 0.34, rise)
  const trail = Math.exp(-((lag / 1.45) ** 2)) * lerpLogoEffect(0.04, 0.42, rise)
  return (core + glow + trail) * appear * fade
}

export function idleLogoEffect(x: number, pixelY: number, frame: Frame, state: IdleState) {
  const dx = x + 0.5 - state.cfg.originX
  const dy = pixelY - state.cfg.originY
  const distance = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const wobble = logoNoise(x * 0.32, pixelY * 0.25, frame.t * 0.0005) - 0.5
  const drift = logoNoise(x * 0.12, pixelY * 0.08, frame.t * 0.00022) - 0.5
  const ripple = Math.sin(angle * 3 + frame.t * 0.0012) * 0.3
  const traveled = distance + (wobble * 0.55 + drift * 0.32 + ripple * 0.18) * state.cfg.noise
  const totals = state.active.reduce(
    (out, active) => {
      const delta = traveled - active.head
      const core = Math.exp(-(Math.abs(delta / state.cfg.coreWidth) ** 1.8))
      const soft = Math.exp(-(Math.abs(delta / state.cfg.softWidth) ** 1.6))
      const tailRange = state.cfg.tail * 2.6
      const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
      const haloBand = Math.exp(-(Math.abs((delta + state.cfg.haloOffset) / state.cfg.haloWidth) ** 1.6))
      return {
        glow: out.glow + (soft * state.cfg.softAmp + tail * state.cfg.tailAmp) * active.eased,
        peak: out.peak + core * state.cfg.coreAmp * active.eased,
        primary: out.primary + (haloBand + tail * 0.6) * active.eased,
        halo: out.halo + haloBand * state.cfg.haloAmp * active.eased,
        ambient: out.ambient + active.ambient,
      }
    },
    { glow: 0, peak: 0, primary: 0, halo: 0, ambient: 0 },
  )
  return {
    glow: totals.glow / state.rings,
    peak: state.cfg.breathBase + totals.ambient / state.rings + (totals.peak + totals.halo) / state.rings,
    primary: (totals.primary / state.rings) * state.cfg.primaryMix,
  }
}

export function bloomLogoEffect(x: number, y: number, frame: Frame, context: LogoContext) {
  const item = frame.glow
  if (!item) return 0
  if (context.MAP.glyph.get(logoCellKey(x, y)) !== item.glyph) return 0
  const age = frame.t - item.at
  if (age < 0 || age > LOGO_GLOW_OUT) return 0
  const progress = age / LOGO_GLOW_OUT
  const center = context.MAP.center.get(item.glyph)
  if (!center) return 0
  const bias = Math.exp(-((Math.hypot(x + 0.5 - center.x, y * 2 + 1 - center.y) / 2.8) ** 2))
  return lerpLogoEffect(item.force, item.force * 0.18, progress) * lerpLogoEffect(0.72, 1.1, bias) * (1 - progress) ** 2
}

export function buildLogoIdleState(time: number, context: LogoContext): IdleState {
  const width = context.FULL[0]?.length ?? 1
  const height = context.FULL.length * 2
  const maxCorner = Math.max(
    ...[
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map(([x, y]) => Math.hypot(x! - shimmerConfig.originX, y! - shimmerConfig.originY)),
  )
  const reach = maxCorner + shimmerConfig.tail * 2
  const rings = Math.max(1, Math.floor(shimmerConfig.rings))
  const active = Array.from({ length: rings }).flatMap((_, index) => {
    const cycle = (time / shimmerConfig.period + index / rings) % 1
    if (cycle >= shimmerConfig.sweepFraction) return []
    const phase = cycle / shimmerConfig.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const distance = (phase - shimmerConfig.ambientCenter) / shimmerConfig.ambientWidth
    return [{
      head: phase * reach,
      eased,
      ambient: Math.abs(distance) < 1 ? (1 - distance * distance) ** 2 * shimmerConfig.ambientAmp : 0,
    }]
  })
  return { cfg: shimmerConfig, reach, rings, active }
}
