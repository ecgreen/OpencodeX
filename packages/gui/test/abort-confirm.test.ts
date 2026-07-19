import { describe, expect, test } from "bun:test"
import { createAbortConfirmGate } from "../src/renderer/src/lib/abort-confirm"

describe("abort confirm gate", () => {
  test("first request confirms, second request inside the window aborts", () => {
    let now = 1000
    const gate = createAbortConfirmGate({ windowMs: 1500, now: () => now })
    expect(gate.request("ses_1")).toBe("confirm")
    now += 500
    expect(gate.request("ses_1")).toBe("abort")
  })

  test("a request after the window expires re-arms instead of aborting", () => {
    let now = 1000
    const gate = createAbortConfirmGate({ windowMs: 1500, now: () => now })
    expect(gate.request("ses_1")).toBe("confirm")
    now += 1600
    expect(gate.request("ses_1")).toBe("confirm")
  })

  test("requests for different sessions do not abort each other", () => {
    const gate = createAbortConfirmGate({ now: () => 1000 })
    expect(gate.request("ses_1")).toBe("confirm")
    expect(gate.request("ses_2")).toBe("confirm")
  })

  test("aborting disarms the gate", () => {
    const gate = createAbortConfirmGate({ now: () => 1000 })
    expect(gate.request("ses_1")).toBe("confirm")
    expect(gate.request("ses_1")).toBe("abort")
    expect(gate.request("ses_1")).toBe("confirm")
  })

  test("disarm resets an armed session", () => {
    const gate = createAbortConfirmGate({ now: () => 1000 })
    expect(gate.request("ses_1")).toBe("confirm")
    gate.disarm()
    expect(gate.request("ses_1")).toBe("confirm")
  })
})
