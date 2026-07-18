import { describe, expect, test } from "bun:test"
import { resolveButtonStyle } from "../src/renderer/src/components/ui/button"

describe("GUI button design-system contract", () => {
  test("provides stable semantic defaults", () => {
    expect(resolveButtonStyle({})).toEqual({ appearance: "solid", tone: "neutral", size: "default", iconOnly: false })
  })

  test("resolves semantic appearance, tone, size, and icon geometry", () => {
    expect(resolveButtonStyle({ appearance: "soft", tone: "warning", size: "prominent", iconOnly: true })).toEqual({
      appearance: "soft",
      tone: "warning",
      size: "prominent",
      iconOnly: true,
    })
  })
})
