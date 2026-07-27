import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import { createGlobalEventBatcher } from "../src/renderer/src/lib/global-event-batcher"

describe("GUI global event batching", () => {
  test("applies one ordered batch and falls back only for unhandled events", async () => {
    const applied: string[][] = []
    const fallback: GlobalEvent[] = []
    const batcher = createGlobalEventBatcher({
      delay: 0,
      apply: (events) => {
        applied.push(events.map((event) => event.id))
        return [true, false]
      },
      fallback: (event) => fallback.push(event),
    })
    const first = { payload: { type: "server.connected", properties: {} } } as GlobalEvent
    const second = { payload: { type: "server.connected", properties: {} } } as GlobalEvent

    batcher.push(first, event("first"))
    batcher.push(second, event("second"))
    await Bun.sleep(5)

    expect(applied).toEqual([["first", "second"]])
    expect(fallback).toEqual([second])
  })

  test("clears pending work on disposal", async () => {
    let calls = 0
    const batcher = createGlobalEventBatcher({
      delay: 1,
      apply: () => {
        calls += 1
        return []
      },
      fallback: () => undefined,
    })
    batcher.push({ payload: { type: "server.connected", properties: {} } } as GlobalEvent, event("pending"))
    batcher.clear()
    await Bun.sleep(5)
    expect(calls).toBe(0)
  })

  test("flushes queued work and applies immediately while session snapshots load", async () => {
    const applied: string[][] = []
    const batcher = createGlobalEventBatcher({
      delay: 100,
      apply: (events) => {
        applied.push(events.map((event) => event.id))
        return events.map(() => true)
      },
      fallback: () => undefined,
    })
    const source = { payload: { type: "server.connected", properties: {} } } as GlobalEvent
    batcher.push(source, event("queued"))
    batcher.setImmediate(true)
    batcher.push(source, event("immediate"))

    expect(applied).toEqual([["queued"], ["immediate"]])
    batcher.clear()
  })
})

function event(id: string) {
  return { id, type: "file.edited", properties: { file: "src/index.ts" } } as Event
}
