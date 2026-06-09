import type { JSX } from "solid-js"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon } from "./icon"
import type { RailDragTarget, RailSectionName } from "./rail-sidebar-types"

type RailSectionDragTarget = Extract<RailDragTarget, { type: "section" }>
type RailSectionDragPreview = { id: RailSectionName; title: string; count: number; x: number; y: number; width: number }

export function Titlebar() {
  return (
    <header class="titlebar">
      <div class="titlebar-drag">
        <Mark />
        <span>OpencodeX</span>
        <small>Premium AI development environment</small>
      </div>
      <div class="window-controls">
        <button aria-label="Minimize" onClick={() => void window.opencodex?.window("minimize")}>-</button>
        <button aria-label="Maximize" onClick={() => void window.opencodex?.window("maximize")}>{"\u25a1"}</button>
        <button aria-label="Close" class="close" onClick={() => void window.opencodex?.window("close")}>{"\u00d7"}</button>
      </div>
    </header>
  )
}

export function RailSection(props: {
  title: string
  count: number
  collapsed: boolean
  toggle: () => void
  action?: () => void
  children: JSX.Element
  drag?: {
    target: RailSectionDragTarget
    active: boolean
    dropping?: "before" | "after"
    start: (event: DragEvent, target: RailSectionDragTarget) => void
    over: (event: DragEvent, target: RailSectionDragTarget) => void
    drop: (targetID: string, placement: "before" | "after") => void
    clear: () => void
    move: (offset: number) => void
    pointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
    pointerDrop: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
  }
}) {
  const [preview, setPreview] = createSignal<RailSectionDragPreview>()
  return (
    <section
      class="rail-section"
      classList={{ "section-slot-placeholder": props.drag?.active }}
      data-rail-section-row-id={props.drag?.target.id}
    >
      <header
        data-rail-section-id={props.drag?.target.id}
        classList={{
          dragging: props.drag?.active,
          dropping: props.drag?.dropping !== undefined,
          "drop-after": props.drag?.dropping === "after",
          "no-action": props.action === undefined,
        }}
        onPointerDown={(event) => props.drag && startRailSectionPointerDrag(event, props.drag, { title: props.title, count: props.count }, setPreview)}
        onDragStart={(event) => props.drag?.start(event, props.drag.target)}
        onDragOver={(event) => props.drag?.over(event, props.drag.target)}
        onDrop={(event) => props.drag?.drop(props.drag.target.id, dropPlacement(event))}
        onDragEnd={() => props.drag?.clear()}
      >
        <button
          class="section-toggle"
          aria-expanded={!props.collapsed}
          onClick={props.toggle}
          onKeyDown={(event) => {
            if (!props.drag || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
            event.preventDefault()
            props.drag.move(event.key === "ArrowUp" ? -1 : 1)
          }}
        >
          <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
          <strong>{props.title} <span class="section-count">({props.count})</span></strong>
        </button>
        {props.action && <button class="section-new" title={`Create ${props.title}`} aria-label={`Create ${props.title}`} onClick={props.action}>+ New</button>}
      </header>
      <div class="rail-section-content" classList={{ collapsed: props.collapsed }}>
        <div>{props.children}</div>
      </div>
      <RailSectionDragPreviewView preview={preview()} />
    </section>
  )
}

function startRailSectionPointerDrag(
  event: PointerEvent & { currentTarget: HTMLElement },
  drag: {
    target: RailSectionDragTarget
    pointerDrag: (sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") => void
    pointerDrop: (sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") => void
    clear: () => void
  },
  label: { title: string; count: number },
  setPreview: (value?: RailSectionDragPreview) => void,
) {
  if (event.button !== 0) return
  const pointerID = event.pointerId
  const sourceRect = event.currentTarget.getBoundingClientRect()
  const origin = { x: event.clientX, y: event.clientY }
  const offset = { x: event.clientX - sourceRect.left, y: event.clientY - sourceRect.top }
  let dragging = false
  let target: { id: RailSectionName; placement: "before" | "after" } | undefined
  let lastTargetKey = ""

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerID) return
    if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return
    dragging = true
    moveEvent.preventDefault()
    setPreview({
      id: drag.target.id,
      title: label.title,
      count: label.count,
      x: moveEvent.clientX - offset.x,
      y: moveEvent.clientY - offset.y,
      width: sourceRect.width,
    })
    const nextTarget = railSectionDropTargetFromPointer(drag.target.id, moveEvent.clientY)
    if (!nextTarget) {
      target = undefined
      if (lastTargetKey !== "") {
        drag.pointerDrag(drag.target.id)
        lastTargetKey = ""
      }
      return
    }
    target = nextTarget
    const targetKey = `${target.id}:${target.placement}`
    if (targetKey === lastTargetKey) return
    lastTargetKey = targetKey
    drag.pointerDrag(drag.target.id, target.id, target.placement)
  }

  const up = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerID) return
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    if (!dragging) return
    upEvent.preventDefault()
    document.addEventListener("click", suppressNextClick, { capture: true, once: true })
    setTimeout(() => document.removeEventListener("click", suppressNextClick, true), 250)
    if (!target) {
      setPreview(undefined)
      drag.clear()
      return
    }
    drag.pointerDrop(drag.target.id, target.id, target.placement)
    setPreview(undefined)
  }

  const cancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerID) return
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    setPreview(undefined)
    drag.clear()
  }

  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
}

function RailSectionDragPreviewView(props: { preview?: RailSectionDragPreview }) {
  return (
    <Show when={props.preview}>
      {(preview) => (
        <Portal>
          <div
            class="rail-section-drag-preview"
            style={{ left: `${preview().x}px`, top: `${preview().y}px`, width: `${preview().width}px` }}
          >
            <span class="section-chevron"><Icon name="chevronDown" /></span>
            <strong>{preview().title} <span class="section-count">({preview().count})</span></strong>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function railSectionName(value: string | undefined): RailSectionName | undefined {
  if (value === "pinned" || value === "projects" || value === "recent" || value === "views") return value
}

function suppressNextClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function railSectionDropTargetFromPointer(sourceID: RailSectionName, clientY: number) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-rail-section-id]"))
    .filter((element) => element.dataset.railSectionId !== sourceID)
  for (const element of elements) {
    const id = railSectionName(element.dataset.railSectionId)
    if (!id) continue
    const rect = element.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return { id, placement: "before" as const }
  }
  const id = railSectionName(elements.at(-1)?.dataset.railSectionId)
  return id ? { id, placement: "after" as const } : undefined
}

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

export function OpencodeXLogo() {
  const [now, setNow] = createSignal(0)
  const ctx = logoContext()

  onMount(() => {
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 16)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="opencodex-logo" aria-label="OpencodeX">
      {LOGO.left.map((line, y) => (
        <div class="opencodex-logo-line" aria-hidden="true">
          <div class="opencodex-logo-run">{renderTuiLogoLine(line, y, "#808080", 0, now(), ctx)}</div>
          <div class="opencodex-logo-gap" />
          <div class="opencodex-logo-run">{renderTuiLogoLine(LOGO.right[y] ?? "", y, "#eeeeee", ctx.left + 1, now(), ctx)}</div>
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

const LOGO_THEME = {
  background: hexToRgb("#0a0a0a"),
  primary: hexToRgb("#fab283"),
  warning: hexToRgb("#f5a742"),
  peak: hexToRgb("#ffffff"),
}

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

function renderTuiLogoLine(line: string, y: number, inkHex: string, off: number, t: number, ctx: ReturnType<typeof logoContext>) {
  return Array.from(line).map((char, i) => {
    const x = off + i
    const charInk = x >= 40 ? LOGO_THEME.warning : hexToRgb(inkHex)
    const shadow = tint(LOGO_THEME.background, charInk, 0.25)
    const top = logoIdle(x, y * 2, t, ctx)
    const bot = logoIdle(x, y * 2 + 1, t, ctx)
    const inkTop = logoPeakTint(charInk, top)
    const inkBot = logoPeakTint(charInk, bot)
    const pulse = { peak: (top.peak + bot.peak) / 2, primary: (top.primary + bot.primary) / 2 }
    const inkTinted = logoPeakTint(charInk, pulse)
    const shadowTop = tint(shadow, LOGO_THEME.peak, Math.min(1, top.peak * LOGO_SHIMMER.shadowMix))
    const shadowBot = tint(shadow, LOGO_THEME.peak, Math.min(1, bot.peak * LOGO_SHIMMER.shadowMix))
    const shadowTinted = tint(shadow, LOGO_THEME.peak, Math.min(1, pulse.peak * LOGO_SHIMMER.shadowMix))
    const shimmer = logoShimmer(x, y, t, ctx)

    if (char === " ") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(charInk) }}>{char}</span>
    if (char === "_") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted), "background-color": rgbToCss(shade(shadowTinted, ghost(shimmer, 0.06))) }}> </span>
    if (char === "^") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>{"\u2580"}</span>
    if (char === "~") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowTop, ghost(shimmer, 0.05))) }}>{"\u2580"}</span>
    if (char === ",") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>{"\u2584"}</span>
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

function logoPeakTint(base: Rgb, pulse: { peak: number; primary: number }) {
  const primary = pulse.primary > 0 ? tint(base, LOGO_THEME.primary, Math.min(1, pulse.primary)) : base
  return pulse.peak > 0 ? tint(primary, LOGO_THEME.peak, Math.min(1, pulse.peak)) : primary
}

function shade(base: Rgb, n: number) {
  if (n >= 0) {
    const mid = tint(base, LOGO_THEME.primary, 0.84)
    const top = tint(LOGO_THEME.primary, LOGO_THEME.peak, 0.96)
    if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
    return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
  }
  return tint(base, LOGO_THEME.background, Math.min(0.82, -n * 0.64))
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

function hexToRgb(hex: string) {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) }
}

function rgbToCss(rgb: Rgb) {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`
}
