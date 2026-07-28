import { describe, expect, test } from "bun:test"
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  COMPOSER_MIN_MAX_HEIGHT,
  composerHeightDecision,
  composerMaxHeight,
} from "../src/renderer/src/lib/composer-height"

describe("GUI composer height clamp", () => {
  test("never grows past 40% of the viewport", () => {
    expect(composerMaxHeight(800)).toBe(320)
    expect(composerMaxHeight(600)).toBe(240)
  })

  test("caps at the absolute maximum on tall windows", () => {
    expect(composerMaxHeight(2_000)).toBe(COMPOSER_MAX_HEIGHT)
  })

  test("keeps a usable minimum on tiny windows and bogus measurements", () => {
    expect(composerMaxHeight(200)).toBe(COMPOSER_MIN_MAX_HEIGHT)
    expect(composerMaxHeight(0)).toBe(COMPOSER_MAX_HEIGHT)
    expect(composerMaxHeight(Number.NaN)).toBe(COMPOSER_MAX_HEIGHT)
  })

  test("short drafts keep the natural height and no scrollbar", () => {
    expect(composerHeightDecision(80, 800)).toEqual({ height: 80, scrollable: false })
    expect(composerHeightDecision(10, 800)).toEqual({ height: COMPOSER_MIN_HEIGHT, scrollable: false })
  })

  test("long drafts clamp and scroll inside the composer instead of eating the transcript", () => {
    expect(composerHeightDecision(1_400, 800)).toEqual({ height: 320, scrollable: true })
  })
})
