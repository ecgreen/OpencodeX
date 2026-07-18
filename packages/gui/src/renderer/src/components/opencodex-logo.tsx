import { createEffect, createSignal, onCleanup, onMount } from "solid-js"

export function OpencodeXLogo(props: { active?: boolean } = {}) {
  const [now, setNow] = createSignal(0)
  const [pageVisible, setPageVisible] = createSignal(document.visibilityState === "visible")
  const [windowFocused, setWindowFocused] = createSignal(document.hasFocus())
  const [reducedMotion, setReducedMotion] = createSignal(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const ctx = logoContext()
  const theme = () => logoTheme(now())

  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible")
    const focus = () => setWindowFocused(true)
    const blur = () => setWindowFocused(false)
    const updateMotion = () => setReducedMotion(media.matches)
    updateMotion()
    document.addEventListener("visibilitychange", updateVisibility)
    window.addEventListener("focus", focus)
    window.addEventListener("blur", blur)
    media.addEventListener("change", updateMotion)
    onCleanup(() => {
      document.removeEventListener("visibilitychange", updateVisibility)
      window.removeEventListener("focus", focus)
      window.removeEventListener("blur", blur)
      media.removeEventListener("change", updateMotion)
    })
  })

  createEffect(() => {
    if (props.active === false || !pageVisible() || !windowFocused() || reducedMotion()) {
      setNow(0)
      return
    }
    setNow(performance.now())
    const timer = window.setInterval(() => setNow(performance.now()), 50)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <div class="opencodex-logo" aria-label="OpencodeX">
      {LOGO.left.map((line, y) => (
        <div class="opencodex-logo-line" aria-hidden="true">
          <div class="opencodex-logo-run">{renderTuiLogoLine(line, y, theme().muted, 0, now(), ctx, theme())}</div>
          <div class="opencodex-logo-gap" />
          <div class="opencodex-logo-run">{renderTuiLogoLine(LOGO.right[y] ?? "", y, theme().text, ctx.left + 1, now(), ctx, theme())}</div>
        </div>
      ))}
    </div>
  )
}

const LOGO = {
  left: ["                   ", "\u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2584", "\u2588__\u2588 \u2588__\u2588 \u2588^^^ \u2588__\u2588", "\u2580\u2580\u2580\u2580 \u2588\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580~~\u2580"],
  right: ["             \u2584            ", "\u2588\u2580\u2580\u2580 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2588\u2580\u2580\u2588 \u2580\u2584\u2580", "\u2588___ \u2588__\u2588 \u2588__\u2588 \u2588^^^ \u2580 \u2580 ", "\u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580 \u2580\u2580\u2580\u2580    "],
}

type Rgb = { r: number; g: number; b: number }

const LOGO_SHIMMER = {
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

function renderTuiLogoLine(line: string, y: number, ink: Rgb, off: number, t: number, ctx: ReturnType<typeof logoContext>, theme: ReturnType<typeof logoTheme>) {
  return Array.from(line).map((char, i) => {
    const x = off + i
    const charInk = x >= 40 ? theme.warning : ink
    const shadow = theme.background
    const top = logoIdle(x, y * 2, t, ctx)
    const bot = logoIdle(x, y * 2 + 1, t, ctx)
    const inkTop = logoPeakTint(charInk, top, theme)
    const inkBot = logoPeakTint(charInk, bot, theme)
    const pulse = { peak: (top.peak + bot.peak) / 2, primary: (top.primary + bot.primary) / 2 }
    const inkTinted = logoPeakTint(charInk, pulse, theme)
    const shadowTop = tint(shadow, theme.peak, Math.min(1, top.peak * LOGO_SHIMMER.shadowMix))
    const shadowBot = tint(shadow, theme.peak, Math.min(1, bot.peak * LOGO_SHIMMER.shadowMix))
    const shadowTinted = tint(shadow, theme.peak, Math.min(1, pulse.peak * LOGO_SHIMMER.shadowMix))
    const shimmer = logoShimmer(x, y, t, ctx)

    if (char === " ") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(charInk) }}>{char}</span>
    if (char === "_") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted), "background-color": rgbToCss(shade(shadowTinted, ghost(shimmer, 0.06), theme)) }}> </span>
    if (char === "^") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(shade(shadowBot, ghost(shimmer, 0.05), theme)) }}>{"\u2580"}</span>
    if (char === "~") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowTop, ghost(shimmer, 0.05), theme)) }}>{"\u2580"}</span>
    if (char === ",") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowBot, ghost(shimmer, 0.05), theme)) }}>{"\u2584"}</span>
    if (char === "\u2588") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(inkBot) }}>{"\u2580"}</span>
    if (char === "\u2580") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop) }}>{"\u2580"}</span>
    if (char === "\u2584") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkBot) }}>{"\u2584"}</span>
    return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted) }}>{char}</span>
  })
}

function logoContext() {
  const full = LOGO.left.map((line, i) => line + " " + LOGO.right[i])
  return {
    left: LOGO.left[0]?.length ?? 0,
    full,
    span: Math.hypot(full[0]?.length ?? 0, full.length * 2) * 0.94,
  }
}

function logoIdle(x: number, pixelY: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const corners = [[0, 0], [ctx.full[0]?.length ?? 1, 0], [0, ctx.full.length * 2], [ctx.full[0]?.length ?? 1, ctx.full.length * 2]]
  const reach = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - LOGO_SHIMMER.originX, cy - LOGO_SHIMMER.originY))) + LOGO_SHIMMER.tail * 2
  const dx = x + 0.5 - LOGO_SHIMMER.originX
  const dy = pixelY - LOGO_SHIMMER.originY
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const wob1 = logoNoise(x * 0.32, pixelY * 0.25, t * 0.0005) - 0.5
  const wob2 = logoNoise(x * 0.12, pixelY * 0.08, t * 0.00022) - 0.5
  const ripple = Math.sin(angle * 3 + t * 0.0012) * 0.3
  const traveled = dist + (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * LOGO_SHIMMER.noise
  const rings = Math.max(1, Math.floor(LOGO_SHIMMER.rings))
  const values = Array.from({ length: rings }).map((_, i) => {
    const cyclePhase = (t / LOGO_SHIMMER.period + i / rings) % 1
    if (cyclePhase >= LOGO_SHIMMER.sweepFraction) return { glow: 0, peak: 0, primary: 0, ambient: 0 }
    const phase = cyclePhase / LOGO_SHIMMER.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const delta = traveled - phase * reach
    const core = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.coreWidth) ** 1.8))
    const soft = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.softWidth) ** 1.6))
    const tailRange = LOGO_SHIMMER.tail * 2.6
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
    const haloBand = Math.exp(-(Math.abs((delta + LOGO_SHIMMER.haloOffset) / LOGO_SHIMMER.haloWidth) ** 1.6))
    const d = (phase - LOGO_SHIMMER.ambientCenter) / LOGO_SHIMMER.ambientWidth
    return {
      glow: (soft * LOGO_SHIMMER.softAmp + tail * LOGO_SHIMMER.tailAmp) * eased,
      peak: (core * LOGO_SHIMMER.coreAmp + haloBand * LOGO_SHIMMER.haloAmp) * eased,
      primary: (haloBand + tail * 0.6) * eased,
      ambient: Math.abs(d) < 1 ? (1 - d * d) ** 2 * LOGO_SHIMMER.ambientAmp : 0,
    }
  })
  return {
    glow: values.reduce((sum, item) => sum + item.glow, 0) / rings,
    peak: LOGO_SHIMMER.breathBase + values.reduce((sum, item) => sum + item.ambient + item.peak, 0) / rings,
    primary: (values.reduce((sum, item) => sum + item.primary, 0) / rings) * LOGO_SHIMMER.primaryMix,
  }
}

function logoShimmer(x: number, y: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const phase = (t / LOGO_SHIMMER.period) % 1
  const head = phase * (ctx.span + LOGO_SHIMMER.tail * 2)
  const delta = Math.hypot(x + 0.5 - LOGO_SHIMMER.originX, y * 2 + 1 - LOGO_SHIMMER.originY) - head
  if (delta < -LOGO_SHIMMER.tail || delta > LOGO_SHIMMER.coreWidth) return 0
  return Math.exp(-(Math.abs(delta / LOGO_SHIMMER.haloWidth) ** 1.6)) * 0.25
}

function logoPeakTint(base: Rgb, pulse: { peak: number; primary: number }, theme: ReturnType<typeof logoTheme>) {
  const primary = pulse.primary > 0 ? tint(base, theme.primary, Math.min(1, pulse.primary)) : base
  return pulse.peak > 0 ? tint(primary, theme.peak, Math.min(1, pulse.peak)) : primary
}

function shade(base: Rgb, n: number, theme: ReturnType<typeof logoTheme>) {
  if (n >= 0) {
    const mid = tint(base, theme.primary, 0.84)
    const top = tint(theme.primary, theme.peak, 0.96)
    if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
    return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
  }
  return tint(base, theme.background, Math.min(0.82, -n * 0.64))
}

function ghost(n: number, scale: number) {
  if (n < 0) return n
  return n * scale
}

function tint(a: Rgb, b: Rgb, amount: number) {
  const t = Math.max(0, Math.min(1, amount))
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

function logoNoise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function logoTheme(_tick: number) {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => cssColorToRgb(style.getPropertyValue(name))
  return {
    background: color("--theme-canvas"),
    primary: color("--theme-accent"),
    warning: color("--theme-warning"),
    peak: color("--theme-text"),
    muted: color("--theme-text-muted"),
    text: color("--theme-text"),
  }
}

function cssColorToRgb(value: string) {
  const hex = value.trim().replace("#", "")
  if (hex.length === 3) return { r: Number.parseInt(hex[0] + hex[0], 16), g: Number.parseInt(hex[1] + hex[1], 16), b: Number.parseInt(hex[2] + hex[2], 16) }
  if (hex.length >= 6) return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) }
  return { r: 0, g: 0, b: 0 }
}

function rgbToCss(rgb: Rgb) {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`
}
