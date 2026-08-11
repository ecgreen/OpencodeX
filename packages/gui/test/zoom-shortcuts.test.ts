import { describe, expect, test } from "bun:test"
import { nextZoomLevel, zoomShortcutAction } from "../src/main/zoom-shortcuts"

const base = { type: "keyDown", key: "", code: "", control: false, meta: false, alt: false }

describe("zoom shortcut action", () => {
  test("ctrl+= zooms in (plus key without shift)", () => {
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal", control: true }, "win32")).toBe("in")
  })

  test("ctrl+shift+= zooms in (literal plus)", () => {
    expect(zoomShortcutAction({ ...base, key: "+", code: "Equal", control: true }, "win32")).toBe("in")
  })

  test("ctrl+numpad-add zooms in", () => {
    expect(zoomShortcutAction({ ...base, key: "+", code: "NumpadAdd", control: true }, "win32")).toBe("in")
  })

  test("ctrl+- zooms out", () => {
    expect(zoomShortcutAction({ ...base, key: "-", code: "Minus", control: true }, "win32")).toBe("out")
  })

  test("ctrl+numpad-subtract zooms out", () => {
    expect(zoomShortcutAction({ ...base, key: "-", code: "NumpadSubtract", control: true }, "win32")).toBe("out")
  })

  test("ctrl+0 resets zoom", () => {
    expect(zoomShortcutAction({ ...base, key: "0", code: "Digit0", control: true }, "win32")).toBe("reset")
  })

  test("no action without the platform modifier", () => {
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal" }, "win32")).toBeUndefined()
  })

  test("no action with alt held (AltGr layouts type characters via ctrl+alt)", () => {
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal", control: true, alt: true }, "win32")).toBeUndefined()
  })

  test("no action on keyUp", () => {
    expect(zoomShortcutAction({ ...base, type: "keyUp", key: "=", code: "Equal", control: true }, "win32")).toBeUndefined()
  })

  test("darwin uses cmd, not ctrl", () => {
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal", meta: true }, "darwin")).toBe("in")
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal", control: true }, "darwin")).toBeUndefined()
  })

  test("win32 uses ctrl, not meta", () => {
    expect(zoomShortcutAction({ ...base, key: "=", code: "Equal", meta: true }, "win32")).toBeUndefined()
  })
})

describe("next zoom level", () => {
  test("steps by half a level", () => {
    expect(nextZoomLevel(0, "in")).toBe(0.5)
    expect(nextZoomLevel(0, "out")).toBe(-0.5)
  })

  test("reset returns to zero from anywhere", () => {
    expect(nextZoomLevel(-3.5, "reset")).toBe(0)
  })

  test("clamps at the chromium zoom bounds", () => {
    expect(nextZoomLevel(8, "in")).toBe(8)
    expect(nextZoomLevel(-8, "out")).toBe(-8)
  })
})
