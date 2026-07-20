import { describe, expect, test } from "bun:test"
import {
  LOGO_FRAME_INTERVAL_MS,
  OPENCODEX_LOGO_GEOMETRY,
  createLogoGeometry,
  logoAnimationEnabled,
  logoCellFrame,
  logoFrameDue,
  type LogoTheme,
} from "../src/renderer/src/lib/opencodex-logo-frame"

const theme: LogoTheme = {
  background: { r: 10, g: 20, b: 30 },
  primary: { r: 180, g: 90, b: 20 },
  warning: { r: 240, g: 160, b: 40 },
  peak: { r: 250, g: 245, b: 235 },
  muted: { r: 80, g: 90, b: 100 },
  text: { r: 210, g: 215, b: 220 },
}

describe("OpencodeX logo frames", () => {
  test("precomputes logo bounds, corners, reach, and cell coordinates", () => {
    const geometry = createLogoGeometry(["AB"], ["CD"])

    expect(geometry.left).toBe(2)
    expect(geometry.width).toBe(5)
    expect(geometry.height).toBe(2)
    expect(geometry.corners).toEqual([[0, 0], [5, 0], [0, 2], [5, 2]])
    expect(geometry.span).toBeCloseTo(Math.hypot(5, 2) * 0.94)
    expect(geometry.reach).toBeCloseTo(Math.hypot(4.5, 13.5) + 10)
    expect(geometry.cells.map((cell) => [cell.char, cell.x, cell.y, cell.top.pixelY, cell.bottom.pixelY])).toEqual([
      ["A", 0, 0, 0, 1],
      ["B", 1, 0, 0, 1],
      ["C", 3, 0, 0, 1],
      ["D", 4, 0, 0, 1],
    ])
    expect(geometry.lines[0]?.left[0]).toBe(geometry.cells[0])
    expect(geometry.lines[0]?.right[0]).toBe(geometry.cells[2])
  })

  test("keeps the production geometry and character transforms stable", () => {
    expect(OPENCODEX_LOGO_GEOMETRY.lines).toHaveLength(4)
    expect(OPENCODEX_LOGO_GEOMETRY.left).toBe(19)
    expect(OPENCODEX_LOGO_GEOMETRY.width).toBe(46)
    expect(OPENCODEX_LOGO_GEOMETRY.height).toBe(8)

    const geometry = createLogoGeometry([" _^~,\u2588\u2580\u2584A"], [])
    expect(geometry.cells.map((cell) => cell.text).join("")).toBe("  \u2580\u2580\u2584\u2580\u2580\u2584A")
    const frames = geometry.cells.map((cell) => logoCellFrame(cell, 1_234, geometry, theme))
    expect(frames.map((frame) => frame.backgroundColor !== undefined)).toEqual([false, true, true, false, false, true, false, false, false])
    expect(frames).toEqual([
      { color: "rgb(80, 90, 100)" },
      { color: "rgb(109, 112, 115)", backgroundColor: "rgb(13, 23, 33)" },
      { color: "rgb(110, 112, 115)", backgroundColor: "rgb(13, 23, 33)" },
      { color: "rgb(13, 23, 33)" },
      { color: "rgb(13, 23, 33)" },
      { color: "rgb(109, 112, 115)", backgroundColor: "rgb(108, 112, 115)" },
      { color: "rgb(110, 112, 115)" },
      { color: "rgb(108, 112, 115)" },
      { color: "rgb(110, 112, 115)" },
    ])
    expect(frames).not.toEqual(geometry.cells.map((cell) => logoCellFrame(cell, 2_345, geometry, theme)))
  })

  test("switches from base ink to warning ink at the existing x threshold", () => {
    const geometry = createLogoGeometry([" ".repeat(41)], [])

    expect(logoCellFrame(geometry.cells[39]!, 0, geometry, theme).color).toBe("rgb(80, 90, 100)")
    expect(logoCellFrame(geometry.cells[40]!, 0, geometry, theme).color).toBe("rgb(240, 160, 40)")
  })

  test("gates animation and admits frames at the 50ms cadence", () => {
    const eligible = { active: true, pageVisible: true, windowFocused: true, reducedMotion: false }
    expect(logoAnimationEnabled(eligible)).toBe(true)
    expect(logoAnimationEnabled({ ...eligible, active: false })).toBe(false)
    expect(logoAnimationEnabled({ ...eligible, pageVisible: false })).toBe(false)
    expect(logoAnimationEnabled({ ...eligible, windowFocused: false })).toBe(false)
    expect(logoAnimationEnabled({ ...eligible, reducedMotion: true })).toBe(false)

    expect(LOGO_FRAME_INTERVAL_MS).toBe(50)
    expect(logoFrameDue(undefined, 1_000)).toBe(true)
    expect(logoFrameDue(1_000, 1_000 + LOGO_FRAME_INTERVAL_MS - 0.01)).toBe(false)
    expect(logoFrameDue(1_000, 1_000 + LOGO_FRAME_INTERVAL_MS)).toBe(true)
  })
})
