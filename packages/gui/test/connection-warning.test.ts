import { describe, expect, test } from "bun:test"
import { shouldShowConnectionWarning } from "../src/renderer/src/lib/connection-warning"

describe("connection warning", () => {
  test("waits until reconnecting to stale state fails once", () => {
    expect(shouldShowConnectionWarning(undefined)).toBe(false)
    expect(shouldShowConnectionWarning({ status: "reconnecting", data: "stale", attempt: 1, retryAt: 1 })).toBe(false)
    expect(shouldShowConnectionWarning({ status: "reconnecting", data: "empty", attempt: 2, retryAt: 1 })).toBe(false)
    expect(shouldShowConnectionWarning({ status: "reconnecting", data: "stale", attempt: 2, retryAt: 1 })).toBe(true)
    expect(shouldShowConnectionWarning({ status: "ready", data: "live", attempt: 0, connectedAt: 1 })).toBe(false)
  })
})
