/** @jsxImportSource @opentui/solid */
import { TextAttributes, type RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { tint } from "@tui/context/theme"
import {
  bloomLogoEffect,
  fieldLogoEffect,
  ghostLogoEffect,
  idleLogoEffect,
  pickLogoEffect,
  shadeLogoEffect,
  shimmerLogoEffect,
  traceLogoEffect,
  waveLogoEffect,
} from "./logo-effects"
import { isLitLogoCell, type LogoContext } from "./logo-geometry"
import { LOGO_PEAK, shimmerConfig, type Frame, type IdleState, type LogoTheme } from "./logo-types"

export function renderLogoLine(input: {
  line: string
  y: number
  ink: RGBA
  bold: boolean
  offset: number
  frame: Frame
  dusk: Frame
  state: IdleState | undefined
  context: LogoContext
  theme: LogoTheme
  subpixel: boolean
}): JSX.Element[] {
  const attributes = input.bold ? TextAttributes.BOLD : undefined

  return Array.from(input.line).map((char, index) => {
    const x = input.offset + index
    const charInk = x >= 40 ? input.theme.warning : input.ink
    const shadow = tint(input.theme.background, charInk, 0.25)
    if (char === " ") {
      return (
        <text fg={charInk} attributes={attributes} selectable={false}>
          {char}
        </text>
      )
    }

    const field = fieldLogoEffect(x, input.y, input.frame, input.context)
    const lit = isLitLogoCell(char)
    const pulseTop = input.state
      ? idleLogoEffect(x, input.y * 2, input.frame, input.state)
      : { glow: 0, peak: 0, primary: 0 }
    const pulseBottom = input.state
      ? idleLogoEffect(x, input.y * 2 + 1, input.frame, input.state)
      : { glow: 0, peak: 0, primary: 0 }
    const peakTop = lit ? Math.min(1, pulseTop.peak) : 0
    const peakBottom = lit ? Math.min(1, pulseBottom.peak) : 0
    const primaryTop = lit ? Math.min(1, pulseTop.primary) : 0
    const primaryBottom = lit ? Math.min(1, pulseBottom.primary) : 0
    const inkTopTint = primaryTop > 0 ? tint(charInk, input.theme.primary, primaryTop) : charInk
    const inkBottomTint = primaryBottom > 0 ? tint(charInk, input.theme.primary, primaryBottom) : charInk
    const inkTop = peakTop > 0 ? tint(inkTopTint, LOGO_PEAK, peakTop) : inkTopTint
    const inkBottom = peakBottom > 0 ? tint(inkBottomTint, LOGO_PEAK, peakBottom) : inkBottomTint
    const pulse = {
      glow: (pulseTop.glow + pulseBottom.glow) / 2,
      peak: (pulseTop.peak + pulseBottom.peak) / 2,
      primary: (pulseTop.primary + pulseBottom.primary) / 2,
    }
    const peak = lit ? Math.min(1, pulse.peak) : 0
    const primary = lit ? Math.min(1, pulse.primary) : 0
    const inkPrimary = primary > 0 ? tint(charInk, input.theme.primary, primary) : charInk
    const inkTinted = peak > 0 ? tint(inkPrimary, LOGO_PEAK, peak) : inkPrimary
    const shadowMix = input.state?.cfg.shadowMix ?? shimmerConfig.shadowMix
    const shadowTopAmount = Math.min(1, pulseTop.peak * shadowMix)
    const shadowBottomAmount = Math.min(1, pulseBottom.peak * shadowMix)
    const shadowTop = shadowTopAmount > 0 ? tint(shadow, LOGO_PEAK, shadowTopAmount) : shadow
    const shadowBottom = shadowBottomAmount > 0 ? tint(shadow, LOGO_PEAK, shadowBottomAmount) : shadow
    const shadowAmount = Math.min(1, pulse.peak * shadowMix)
    const shadowTinted = shadowAmount > 0 ? tint(shadow, LOGO_PEAK, shadowAmount) : shadow
    const light = waveLogoEffect(x, input.y, input.frame, lit, input.context) + field
    const shadowLight = waveLogoEffect(x, input.y, input.dusk, false, input.context) + field
    const pick = lit ? pickLogoEffect(x, input.y, input.frame, input.context) : 0
    const trace = lit ? traceLogoEffect(x, input.y, input.frame, input.context) : 0
    const bloom = lit ? bloomLogoEffect(x, input.y, input.frame, input.context) : 0
    const shimmer = shimmerLogoEffect(x, input.y, input.frame, input.context)

    if (char === "_") {
      return (
        <text
          fg={shadeLogoEffect(inkTinted, input.theme, shadowLight * 0.08)}
          bg={shadeLogoEffect(shadowTinted, input.theme, ghostLogoEffect(shadowLight, 0.24) + ghostLogoEffect(shimmer, 0.06))}
          attributes={attributes}
          selectable={false}
        >
          {" "}
        </text>
      )
    }
    if (char === "^") {
      return (
        <text
          fg={shadeLogoEffect(inkTop, input.theme, light + pick + trace + bloom)}
          bg={shadeLogoEffect(
            shadowBottom,
            input.theme,
            ghostLogoEffect(shadowLight, 0.18) + ghostLogoEffect(shimmer, 0.05) + ghostLogoEffect(bloom, 0.08),
          )}
          attributes={attributes}
          selectable={false}
        >
          ▀
        </text>
      )
    }
    if (char === "~") {
      return (
        <text
          fg={shadeLogoEffect(shadowTop, input.theme, ghostLogoEffect(shadowLight, 0.22) + ghostLogoEffect(shimmer, 0.05))}
          attributes={attributes}
          selectable={false}
        >
          ▀
        </text>
      )
    }
    if (char === ",") {
      return (
        <text
          fg={shadeLogoEffect(
            shadowBottom,
            input.theme,
            ghostLogoEffect(shadowLight, 0.22) + ghostLogoEffect(shimmer, 0.05),
          )}
          attributes={attributes}
          selectable={false}
        >
          ▄
        </text>
      )
    }
    if (char === "█" && input.subpixel) {
      return (
        <text
          fg={shadeLogoEffect(inkTop, input.theme, light + pick + trace + bloom)}
          bg={shadeLogoEffect(inkBottom, input.theme, light + pick + trace + bloom)}
          attributes={attributes}
          selectable={false}
        >
          ▀
        </text>
      )
    }
    if (char === "▀") {
      return (
        <text fg={shadeLogoEffect(inkTop, input.theme, light + pick + trace + bloom)} attributes={attributes} selectable={false}>
          ▀
        </text>
      )
    }
    if (char === "▄") {
      return (
        <text
          fg={shadeLogoEffect(inkBottom, input.theme, light + pick + trace + bloom)}
          attributes={attributes}
          selectable={false}
        >
          ▄
        </text>
      )
    }
    return (
      <text fg={shadeLogoEffect(inkTinted, input.theme, light + pick + trace + bloom)} attributes={attributes} selectable={false}>
        {char}
      </text>
    )
  })
}
