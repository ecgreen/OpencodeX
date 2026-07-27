import { describe, expect, test } from "bun:test"
import {
  isPermissionMode,
  permissionModeOption,
  PERMISSION_MODE_OPTIONS,
} from "../src/renderer/src/lib/permission-mode"

describe("GUI permission modes", () => {
  test("presents the safety gradient in order", () => {
    expect(PERMISSION_MODE_OPTIONS.map((option) => option.id)).toEqual(["strict", "configured", "auto", "yolo"])
    expect(permissionModeOption("configured")?.meta).toBe("Recommended")
    expect(permissionModeOption("yolo")?.description).toContain("every action")
  })

  test("accepts only supported persisted modes", () => {
    expect(isPermissionMode("strict")).toBe(true)
    expect(isPermissionMode("yolo")).toBe(true)
    expect(isPermissionMode("allow")).toBe(false)
    expect(isPermissionMode(undefined)).toBe(false)
  })
})
