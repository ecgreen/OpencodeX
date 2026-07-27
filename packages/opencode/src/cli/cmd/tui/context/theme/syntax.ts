import { RGBA, SyntaxStyle } from "@opentui/core"
import { markupSyntaxRules } from "./syntax-markup-rules"
import { coreSyntaxRules } from "./syntax-rules"
import type { SyntaxStyleOverrides, Theme } from "./types"

export function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme([...coreSyntaxRules(theme), ...markupSyntaxRules(theme)])
}

export function generateSubtleSyntax(theme: Theme, overrides?: SyntaxStyleOverrides) {
  return SyntaxStyle.fromTheme(
    [...coreSyntaxRules(theme), ...markupSyntaxRules(theme)].map((rule) => {
      const override = rule.scope.reduce((acc, scope) => ({ ...acc, ...overrides?.[scope] }), {})
      if (!rule.style.foreground) return rule
      const foreground = rule.style.foreground
      return {
        ...rule,
        style: {
          ...rule.style,
          ...override,
          foreground: RGBA.fromInts(
            Math.round(foreground.r * 255),
            Math.round(foreground.g * 255),
            Math.round(foreground.b * 255),
            Math.round(theme.thinkingOpacity * 255),
          ),
        },
      }
    }),
  )
}
