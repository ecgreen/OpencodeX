/** @jsxImportSource @opentui/solid */
import { BoxRenderable, MouseEvent, type RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { go } from "@/cli/logo"
import {
  buildLogoIdleState,
  lerpLogoEffect,
  logoNoise,
  pushLogoEffect,
  rampLogoEffect,
} from "./logo-effects"
import { buildLogoContext, defaultLogoContext, selectLogoGlyph } from "./logo-geometry"
import { renderLogoLine } from "./logo-render"
import {
  LOGO_CHARGE,
  LOGO_GAP,
  LOGO_GLOW_OUT,
  LOGO_HOLD,
  LOGO_KICK,
  LOGO_LAG,
  LOGO_LEFT_MOUSE_BUTTON,
  LOGO_LIFE,
  type Glow,
  type Hold,
  type LogoShape,
  type Release,
  type Ring,
} from "./logo-types"

export function Logo(props: { shape?: LogoShape; ink?: RGBA; idle?: boolean; animate?: boolean } = {}) {
  const context = props.shape ? buildLogoContext(props.shape) : defaultLogoContext
  const themeState = useTheme()
  const renderer = useRenderer()
  const [rings, setRings] = createSignal<Ring[]>([])
  const [hold, setHold] = createSignal<Hold>()
  const [release, setRelease] = createSignal<Release>()
  const [glow, setGlow] = createSignal<Glow>()
  const [now, setNow] = createSignal(0)
  let box: BoxRenderable | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  const burst = (x: number, y: number) => {
    const item = hold()
    if (!item) return
    const time = performance.now()
    const rise = rampLogoEffect(time - item.at, LOGO_HOLD, LOGO_CHARGE)
    const level = pushLogoEffect(rise)
    setHold(undefined)
    setRelease({ x, y, at: time, glyph: item.glyph, level, rise })
    if (item.glyph !== undefined) {
      setGlow({ glyph: item.glyph, at: time, force: lerpLogoEffect(0.18, 1.5, rise * level) })
    }
    setRings((list) => [
      ...list,
      {
        x: x + 0.5,
        y: y * 2 + 1,
        at: time,
        force: lerpLogoEffect(0.82, 2.55, level),
        kick: lerpLogoEffect(0.32, 0.32 + LOGO_KICK, level),
      },
    ])
    setNow(time)
    start()
  }

  const tick = () => {
    const time = performance.now()
    setNow(time)
    const pressed = hold()
    if (pressed && time - pressed.at >= LOGO_CHARGE) burst(pressed.x, pressed.y)
    const next = rings().filter((item) => time - item.at < LOGO_LIFE)
    setRings(next)
    const flash = glow()
    if (flash && time - flash.at >= LOGO_GLOW_OUT) setGlow(undefined)
    if (!next.length) setRelease(undefined)
    if (next.length || hold() || release() || glow() || props.idle) return
    stop()
  }

  const start = () => {
    if (timer) return
    timer = setInterval(tick, 50)
  }

  onCleanup(stop)

  createEffect(() => {
    if (!props.idle || props.animate === false) {
      stop()
      setNow(0)
      return
    }
    setNow(performance.now())
    start()
  })

  const press = (x: number, y: number, time: number) => {
    const previous = hold()
    if (previous) burst(previous.x, previous.y)
    setNow(time)
    if (!previous) setRelease(undefined)
    setHold({ x, y, at: time, glyph: selectLogoGlyph(x, y, context) })
    start()
  }

  const frame = createMemo(() => {
    const time = now()
    const item = hold()
    return {
      t: time,
      list: rings(),
      hold: item,
      release: release(),
      glow: glow(),
      spark: item ? logoNoise(item.x, item.y, time) : 0,
    }
  })

  const dusk = createMemo(() => {
    const current = frame()
    const time = current.t - LOGO_LAG
    return {
      ...current,
      t: time,
      spark: current.hold ? logoNoise(current.hold.x, current.hold.y, time) : 0,
    }
  })
  const idleState = createMemo(() => (props.idle ? buildLogoIdleState(frame().t, context) : undefined))

  const mouse = (event: MouseEvent) => {
    if (!box) return
    if ((event.type === "down" || event.type === "drag") && event.button === LOGO_LEFT_MOUSE_BUTTON) {
      const x = event.x - box.x
      const y = event.y - box.y
      if (context.FULL[y]?.[x] === undefined || context.FULL[y]?.[x] === " ") return
      if (event.type === "drag" && hold()) return
      event.preventDefault()
      event.stopPropagation()
      press(x, y, performance.now())
      return
    }
    if (!hold() || event.type !== "up") return
    const item = hold()
    if (item) burst(item.x, item.y)
  }

  return (
    <box ref={(element: BoxRenderable) => (box = element)}>
      <box
        position="absolute"
        top={0}
        left={0}
        width={context.FULL[0]?.length ?? 0}
        height={context.FULL.length}
        zIndex={1}
        onMouse={mouse}
      />
      <For each={context.shape.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">
              {renderLogoLine({
                line,
                y: index(),
                ink: props.ink ?? themeState.theme.textMuted,
                bold: Boolean(props.ink),
                offset: 0,
                frame: frame(),
                dusk: dusk(),
                state: idleState(),
                context,
                theme: themeState.theme,
                subpixel: renderer.capabilities?.rgb === true,
              })}
            </box>
            <box flexDirection="row">
              {renderLogoLine({
                line: context.shape.right[index()] ?? "",
                y: index(),
                ink: props.ink ?? themeState.theme.text,
                bold: true,
                offset: context.LEFT + LOGO_GAP,
                frame: frame(),
                dusk: dusk(),
                state: idleState(),
                context,
                theme: themeState.theme,
                subpixel: renderer.capabilities?.rgb === true,
              })}
            </box>
          </box>
        )}
      </For>
    </box>
  )
}

export function GoLogo() {
  const themeState = useTheme()
  return <Logo shape={go} ink={tint(themeState.theme.background, themeState.theme.text, 0.62)} idle />
}

export { LogoShimmerText } from "./logo-shimmer-text"
export type { LogoShape } from "./logo-types"
