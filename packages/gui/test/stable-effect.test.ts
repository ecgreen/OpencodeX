import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  createStableEffect,
  setStableEffectReporter,
  STABLE_EFFECT_RERUN_LIMIT,
  type StableEffectReport,
} from "../src/renderer/src/lib/stable-effect"

/** Effects flush after the owning root's body returns, so tests wait a tick. */
const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("createStableEffect", () => {
  test("runs like a normal effect while everything converges", async () => {
    const [value, setValue] = createSignal(0)
    const seen: number[] = []
    const dispose = createRoot((dispose) => {
      createStableEffect("converging", () => seen.push(value()))
      return dispose
    })
    await tick()
    setValue(1)
    setValue(2)
    expect(seen).toEqual([0, 1, 2])
    dispose()
  })

  test("a self-write that settles is left alone", async () => {
    const [count, setCount] = createSignal(0)
    let runs = 0
    const dispose = createRoot((dispose) => {
      // The classic shape: writes the signal it reads, but converges at once.
      createStableEffect("settling", () => {
        runs += 1
        if (count() < 3) setCount(3)
      })
      return dispose
    })
    await tick()
    expect(count()).toBe(3)
    expect(runs).toBe(2)
    dispose()
  })

  test("breaks a runaway cycle instead of spinning forever", async () => {
    const reports: StableEffectReport[] = []
    const restore = setStableEffectReporter((detail) => reports.push(detail))
    let runs = 0
    const dispose = createRoot((dispose) => {
      const [value, setValue] = createSignal(0)
      // Never converges: every run writes a value it has not seen before.
      createStableEffect("runaway", () => {
        runs += 1
        setValue(value() + 1)
      })
      return dispose
    })
    // The point of the whole exercise: control came back at all.
    await tick()
    // The body ran up to the limit; the run that crossed it is the break.
    expect(runs).toBe(STABLE_EFFECT_RERUN_LIMIT)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.name).toBe("runaway")
    // Reported once per broken flush, not once per re-run.
    expect(reports[0]?.runs).toBe(STABLE_EFFECT_RERUN_LIMIT + 1)
    dispose()
    restore()
  })

  test("a cycle that keeps re-forming backs off instead of burning the loop", async () => {
    const reports: StableEffectReport[] = []
    const restore = setStableEffectReporter((detail) => reports.push(detail))
    const dispose = createRoot((dispose) => {
      const [value, setValue] = createSignal(0)
      createStableEffect("relapsing", () => setValue(value() + 1))
      return dispose
    })
    // Retries are spaced by a growing timer, so a permanently broken cycle
    // cannot monopolise the event loop: a handful of bounded bursts across a
    // quarter second, not the thousands an unguarded spin would manage.
    await tick(250)
    expect(reports.length).toBeGreaterThan(1)
    expect(reports.length).toBeLessThan(12)
    // Consecutive breaks are counted, which is what drives the backoff.
    expect(reports.at(-1)?.breaks).toBeGreaterThan(1)
    for (const detail of reports) expect(detail.runs).toBe(STABLE_EFFECT_RERUN_LIMIT + 1)
    dispose()
    restore()
  })

  test("wakes up again after a break, so its pane is not dead", async () => {
    const restore = setStableEffectReporter(() => {})
    const [other, setOther] = createSignal("a")
    const seen: string[] = []
    const dispose = createRoot((dispose) => {
      const [spin, setSpin] = createSignal(0)
      createStableEffect("recovering", () => {
        seen.push(other())
        // Enough to break one flush, then it settles on its own.
        if (spin() < STABLE_EFFECT_RERUN_LIMIT + 5) setSpin(spin() + 1)
      })
      return dispose
    })
    await tick()
    expect(seen.length).toBe(STABLE_EFFECT_RERUN_LIMIT)
    await tick(50)
    // It re-ran once the queue drained, so it is still subscribed to everything
    // it reads - a later change from outside still lands.
    expect(seen.length).toBeGreaterThan(STABLE_EFFECT_RERUN_LIMIT)
    setOther("b")
    expect(seen.at(-1)).toBe("b")
    dispose()
    restore()
  })
})
