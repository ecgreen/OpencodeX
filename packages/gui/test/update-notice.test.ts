import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import {
  isNewerVersion,
  shouldShowUpdateNotice,
  updateAvailableVersion,
} from "../src/renderer/src/lib/update-notice"

describe("update available notice", () => {
  test("reads the version from the installation event only", () => {
    expect(updateAvailableVersion(event("installation.update-available", { version: "1.2.4" }))).toBe("1.2.4")
    expect(updateAvailableVersion(event("session.idle", { version: "1.2.4" }))).toBeUndefined()
    expect(updateAvailableVersion(event("installation.update-available", { version: 124 }))).toBeUndefined()
    expect(updateAvailableVersion(event("installation.update-available", {}))).toBeUndefined()
  })

  test("orders release versions the way the TUI's semver guard does", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true)
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true)
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true)
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false)
    expect(isNewerVersion("1.2.2", "1.2.3")).toBe(false)
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false)
    expect(isNewerVersion("1.2.10", "1.2.9")).toBe(true)
  })

  test("hides a skipped release and anything older, but not a newer one", () => {
    expect(shouldShowUpdateNotice(undefined, undefined)).toBe(false)
    expect(shouldShowUpdateNotice({ version: "1.2.4", skipped: false }, undefined)).toBe(true)
    expect(shouldShowUpdateNotice({ version: "1.2.4", skipped: true }, undefined)).toBe(false)
    expect(shouldShowUpdateNotice({ version: "1.2.4", skipped: false }, "1.2.4")).toBe(false)
    expect(shouldShowUpdateNotice({ version: "1.2.3", skipped: false }, "1.2.4")).toBe(false)
    expect(shouldShowUpdateNotice({ version: "1.2.5", skipped: false }, "1.2.4")).toBe(true)
  })
})

function event(type: string, properties: Record<string, unknown>) {
  // The generated GlobalEvent union correlates payload names and data; a fixture cannot express that.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return { directory: "/repo", payload: { id: "evt_1", type, properties } } as unknown as GlobalEvent
}
