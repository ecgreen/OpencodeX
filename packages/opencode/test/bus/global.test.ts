import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus, subscribeGlobalBus, type GlobalEvent } from "@/bus/global"

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

describe("global bus subscriptions", () => {
  test("fans out many subscribers through one emitter listener", () => {
    const before = GlobalBus.listenerCount("event")
    const calls = Array.from({ length: 24 }, () => 0)

    calls.forEach((_, index) => {
      cleanups.push(subscribeGlobalBus(() => {
        calls[index] += 1
      }))
    })

    expect(GlobalBus.listenerCount("event")).toBe(before + 1)
    GlobalBus.emit("event", { directory: "test", payload: { type: "test.event" } })
    expect(calls.every((count) => count === 1)).toBe(true)
  })

  test("releases the emitter listener after the final subscriber", () => {
    const before = GlobalBus.listenerCount("event")
    const first = subscribeGlobalBus(() => undefined)
    const second = subscribeGlobalBus(() => undefined)

    expect(GlobalBus.listenerCount("event")).toBe(before + 1)
    first()
    expect(GlobalBus.listenerCount("event")).toBe(before + 1)
    second()
    expect(GlobalBus.listenerCount("event")).toBe(before)
  })

  test("tracks repeated callback subscriptions independently", () => {
    const seen: string[] = []
    const callback = (event: GlobalEvent) => seen.push(event.payload.type)
    const first = subscribeGlobalBus(callback)
    const second = subscribeGlobalBus(callback)
    first()
    GlobalBus.emit("event", { payload: { id: "evt-repeat", type: "repeat", properties: {} } })
    expect(seen).toEqual(["repeat"])
    second()
  })
})
