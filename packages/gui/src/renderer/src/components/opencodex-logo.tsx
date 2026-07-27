import { createEffect, onCleanup, onMount } from "solid-js"
import {
  OPENCODEX_LOGO_GEOMETRY,
  cssColorToRgb,
  logoAnimationEnabled,
  logoCellFrame,
  logoFrameDue,
  type LogoTheme,
} from "../lib/opencodex-logo-frame"

export function OpencodeXLogo(props: { active?: boolean } = {}) {
  const nodes: (HTMLSpanElement | undefined)[] = []
  const media = window.matchMedia("(prefers-reduced-motion: reduce)")
  const animation = {
    active: props.active !== false,
    pageVisible: document.visibilityState === "visible",
    windowFocused: document.hasFocus(),
    reducedMotion: media.matches,
    mounted: false,
    frame: undefined as number | undefined,
    lastPaint: undefined as number | undefined,
    theme: undefined as LogoTheme | undefined,
  }

  const enabled = () => logoAnimationEnabled(animation)
  const paint = (time: number) => {
    const theme = animation.theme
    if (!theme) return
    OPENCODEX_LOGO_GEOMETRY.cells.forEach((cell) => {
      const node = nodes[cell.index]
      if (!node) return
      const frame = logoCellFrame(cell, time, OPENCODEX_LOGO_GEOMETRY, theme)
      if (node.style.color !== frame.color) node.style.color = frame.color
      if (frame.backgroundColor !== undefined && node.style.backgroundColor !== frame.backgroundColor) node.style.backgroundColor = frame.backgroundColor
    })
  }
  const cancelFrame = () => {
    if (animation.frame === undefined) return
    window.cancelAnimationFrame(animation.frame)
    animation.frame = undefined
  }
  const animate: FrameRequestCallback = (time) => {
    animation.frame = undefined
    if (!enabled()) return
    if (logoFrameDue(animation.lastPaint, time)) {
      animation.lastPaint = time
      paint(time)
    }
    animation.frame = window.requestAnimationFrame(animate)
  }
  const syncAnimation = () => {
    if (!animation.mounted) return
    cancelFrame()
    const time = enabled() ? performance.now() : 0
    animation.lastPaint = time
    paint(time)
    if (enabled()) animation.frame = window.requestAnimationFrame(animate)
  }

  onMount(() => {
    animation.mounted = true
    animation.theme = logoTheme()
    const updateVisibility = () => {
      const visible = document.visibilityState === "visible"
      if (animation.pageVisible === visible) return
      animation.pageVisible = visible
      syncAnimation()
    }
    const focus = () => {
      if (animation.windowFocused) return
      animation.windowFocused = true
      syncAnimation()
    }
    const blur = () => {
      if (!animation.windowFocused) return
      animation.windowFocused = false
      syncAnimation()
    }
    const updateMotion = () => {
      if (animation.reducedMotion === media.matches) return
      animation.reducedMotion = media.matches
      syncAnimation()
    }
    const themeObserver = new MutationObserver(() => {
      animation.theme = logoTheme()
      syncAnimation()
    })
    document.addEventListener("visibilitychange", updateVisibility)
    window.addEventListener("focus", focus)
    window.addEventListener("blur", blur)
    media.addEventListener("change", updateMotion)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    syncAnimation()
    onCleanup(() => {
      animation.mounted = false
      cancelFrame()
      themeObserver.disconnect()
      document.removeEventListener("visibilitychange", updateVisibility)
      window.removeEventListener("focus", focus)
      window.removeEventListener("blur", blur)
      media.removeEventListener("change", updateMotion)
    })
  })

  createEffect(() => {
    const active = props.active !== false
    if (animation.active === active) return
    animation.active = active
    syncAnimation()
  })

  return (
    <div class="opencodex-logo" aria-label="OpencodeX">
      {OPENCODEX_LOGO_GEOMETRY.lines.map((line) => (
        <div class="opencodex-logo-line" aria-hidden="true">
          <div class="opencodex-logo-run">
            {line.left.map((cell) => <span ref={(node) => { nodes[cell.index] = node }} class="opencodex-logo-cell">{cell.text}</span>)}
          </div>
          <div class="opencodex-logo-gap" />
          <div class="opencodex-logo-run">
            {line.right.map((cell) => <span ref={(node) => { nodes[cell.index] = node }} class="opencodex-logo-cell">{cell.text}</span>)}
          </div>
        </div>
      ))}
    </div>
  )
}

function logoTheme(): LogoTheme {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => cssColorToRgb(style.getPropertyValue(name))
  const background = color("--theme-canvas")
  // Derived from the canvas rather than the theme name, so a future light
  // palette gets the right treatment without being special-cased here.
  const lightCanvas = relativeLuminance(background) > 0.45
  return {
    background,
    primary: color("--theme-accent"),
    warning: color("--theme-warning"),
    peak: color("--theme-text"),
    muted: color("--theme-text-muted"),
    text: color("--theme-text"),
    // Ink on paper: the crest warms toward the accent instead of driving to
    // black, and the halo behind the glyphs stays a hint rather than a smudge.
    glow: lightCanvas ? color("--theme-accent") : color("--theme-text"),
    shadowScale: lightCanvas ? 0.3 : 1,
  }
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }) {
  const channel = (value: number) => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
