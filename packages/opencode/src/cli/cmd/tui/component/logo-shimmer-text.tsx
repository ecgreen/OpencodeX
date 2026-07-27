/** @jsxImportSource @opentui/solid */
import { TextAttributes, type RGBA } from "@opentui/core"
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { idleLogoEffect } from "./logo-effects"
import { LOGO_PEAK, shimmerConfig, type Frame, type IdleState } from "./logo-types"

export function LogoShimmerText(props: {
  text: string
  ink?: RGBA
  attributes?: typeof TextAttributes.BOLD
  wrapMode?: "none" | "word" | "char"
  truncate?: boolean
}) {
  const themeState = useTheme()
  const [now, setNow] = createSignal(0)

  onMount(() => {
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 50)
    onCleanup(() => clearInterval(timer))
  })

  const state = createMemo(() => {
    const config = {
      ...shimmerConfig,
      period: 3400,
      rings: 1,
      originX: -1,
      originY: 1,
      sweepFraction: 0.92,
      ambientAmp: 0.24,
      shadowMix: 0,
      primaryMix: 0.42,
    }
    const reach = Math.max(1, Array.from(props.text).length) + config.tail * 2 + 3
    const phase = (now() / config.period) % 1
    const envelope = Math.sin((phase / config.sweepFraction) * Math.PI)
    const eased = phase < config.sweepFraction ? envelope * envelope * (3 - 2 * envelope) : 0
    const distance = (phase / config.sweepFraction - config.ambientCenter) / config.ambientWidth
    return {
      cfg: config,
      reach,
      rings: 1,
      active:
        phase < config.sweepFraction
          ? [
              {
                head: (phase / config.sweepFraction) * reach,
                eased,
                ambient: Math.abs(distance) < 1 ? (1 - distance * distance) ** 2 * config.ambientAmp : 0,
              },
            ]
          : [],
    } satisfies IdleState
  })

  return (
    <text attributes={props.attributes} wrapMode={props.wrapMode} truncate={props.truncate}>
      <For each={Array.from(props.text)}>
        {(char, index) => {
          const color = createMemo(() => {
            const base = props.ink ?? themeState.theme.text
            if (char === " ") return base
            const frame: Frame = {
              t: now(),
              list: [],
              hold: undefined,
              release: undefined,
              glow: undefined,
              spark: 0,
            }
            const top = idleLogoEffect(index(), 0, frame, state())
            const bottom = idleLogoEffect(index(), 1, frame, state())
            const peak = Math.min(1, (top.peak + bottom.peak) / 2)
            const primaryMix = Math.min(1, (top.primary + bottom.primary) / 2)
            const primary = primaryMix > 0 ? tint(base, themeState.theme.primary, primaryMix) : base
            return peak > 0 ? tint(primary, LOGO_PEAK, peak) : primary
          })
          return <span style={{ fg: color() }}>{char}</span>
        }}
      </For>
    </text>
  )
}
