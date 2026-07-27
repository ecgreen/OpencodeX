import { describe, expect, test } from "bun:test"
import { TERMINAL_OUTPUT_BATCH_BYTES, createTerminalOutputBatcher } from "../src/main/terminal-output-batcher"

describe("terminal output batching", () => {
  test("preserves exact string order until the scheduled flush", () => {
    const output: string[] = []
    const timers = timerHarness()
    const batch = createTerminalOutputBatcher({ emit: (data) => output.push(data), schedule: timers.schedule, cancel: timers.cancel })

    batch.push("first")
    batch.push("🙂")
    batch.push("last")
    expect(output).toEqual([])
    timers.run()
    expect(output).toEqual(["first🙂last"])
  })

  test("flushes early at the byte cap without splitting multibyte output", () => {
    const output: string[] = []
    const timers = timerHarness()
    const batch = createTerminalOutputBatcher({ emit: (data) => output.push(data), maxBytes: 5, schedule: timers.schedule, cancel: timers.cancel })

    batch.push("éé")
    batch.push("x")
    expect(output).toEqual(["ééx"])
    expect(timers.cancelled()).toBe(true)
  })

  test("splits single and crossing oversized chunks into ordered UTF-8-safe batches", () => {
    const output: string[] = []
    const timers = timerHarness()
    const batch = createTerminalOutputBatcher({ emit: (data) => output.push(data), maxBytes: 8, schedule: timers.schedule, cancel: timers.cancel })
    const value = `ab${"🙂".repeat(4)}cd`

    batch.push("123456")
    batch.push(value)
    batch.close(true)

    expect(output.join("")).toBe(`123456${value}`)
    expect(output.map((data) => Buffer.byteLength(data))).toEqual([8, 8, 8, 2])
    expect(output.every((data) => !data.includes("�") && Buffer.byteLength(data) <= 8)).toBe(true)
  })

  test("enforces the production 256 KiB cap for one oversized chunk", () => {
    const output: string[] = []
    const batch = createTerminalOutputBatcher({ emit: (data) => output.push(data) })
    const value = `${"🙂".repeat(TERMINAL_OUTPUT_BATCH_BYTES / 4)}tail`
    batch.push(value)
    batch.close(true)

    expect(output.join("")).toBe(value)
    expect(output.map((data) => Buffer.byteLength(data))).toEqual([TERMINAL_OUTPUT_BATCH_BYTES, 4])
  })

  test("flushes before exit and drops pending output on destroy", () => {
    const exited: string[] = []
    const exitTimers = timerHarness()
    const exitBatch = createTerminalOutputBatcher({ emit: (data) => exited.push(data), schedule: exitTimers.schedule, cancel: exitTimers.cancel })
    exitBatch.push("before exit")
    exitBatch.close(true)
    expect(exited).toEqual(["before exit"])

    const destroyed: string[] = []
    const destroyTimers = timerHarness()
    const destroyBatch = createTerminalOutputBatcher({ emit: (data) => destroyed.push(data), schedule: destroyTimers.schedule, cancel: destroyTimers.cancel })
    destroyBatch.push("discard")
    destroyBatch.close(false)
    destroyTimers.run()
    destroyBatch.push("late")
    expect(destroyed).toEqual([])
    expect(destroyTimers.cancelled()).toBe(true)
  })
})

function timerHarness() {
  let callback: (() => void) | undefined
  let wasCancelled = false
  return {
    schedule(next: () => void) {
      callback = next
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    cancel() {
      wasCancelled = true
      callback = undefined
    },
    run() {
      const next = callback
      callback = undefined
      next?.()
    },
    cancelled: () => wasCancelled,
  }
}
