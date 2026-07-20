import { afterEach, describe, expect, test } from "bun:test"
import {
  RENDERER_PERFORMANCE_MARKS,
  RENDERER_PERFORMANCE_MEASURES,
  finishPerformance,
  markPerformance,
  measurePerformance,
  performanceSummaries,
  recordPerformanceDetail,
  startPerformance,
  type UserTiming,
} from "../src/renderer/src/lib/performance"

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__opencodexPerformanceEnabled")
  Reflect.deleteProperty(globalThis, "__opencodexPerformanceMetrics")
  Reflect.deleteProperty(globalThis, "__opencodexPerformanceDetails")
})

describe("renderer performance instrumentation", () => {
  test("uses stable milestone names and forwards User Timing calls", () => {
    const calls: string[][] = []
    const timing: UserTiming = {
      mark: (name) => calls.push(["mark", name]),
      measure: (name, start, end) => calls.push(["measure", name, start, end]),
    }

    markPerformance(RENDERER_PERFORMANCE_MARKS.bootstrap, timing)
    measurePerformance(
      RENDERER_PERFORMANCE_MEASURES.bootstrapToAppMounted,
      RENDERER_PERFORMANCE_MARKS.bootstrap,
      RENDERER_PERFORMANCE_MARKS.appMounted,
      timing,
    )

    expect(calls).toEqual([
      ["mark", "opencodex.renderer.bootstrap"],
      [
        "measure",
        "opencodex.renderer.bootstrap-to-app-mounted",
        "opencodex.renderer.bootstrap",
        "opencodex.renderer.app-mounted",
      ],
    ])
  })

  test("no-ops when User Timing is unavailable or rejects an entry", () => {
    expect(() => markPerformance(RENDERER_PERFORMANCE_MARKS.bootstrap, null)).not.toThrow()
    expect(() => measurePerformance(
      RENDERER_PERFORMANCE_MEASURES.bootstrapToAppMounted,
      RENDERER_PERFORMANCE_MARKS.bootstrap,
      RENDERER_PERFORMANCE_MARKS.appMounted,
      null,
    )).not.toThrow()

    const timing: UserTiming = {
      mark: () => {
        throw new Error("mark unavailable")
      },
      measure: () => {
        throw new Error("measure unavailable")
      },
    }
    expect(() => markPerformance(RENDERER_PERFORMANCE_MARKS.bootstrap, timing)).not.toThrow()
    expect(() => measurePerformance(
      RENDERER_PERFORMANCE_MEASURES.bootstrapToAppMounted,
      RENDERER_PERFORMANCE_MARKS.bootstrap,
      RENDERER_PERFORMANCE_MARKS.appMounted,
      timing,
    )).not.toThrow()
  })

  test("records aggregate durations only when enabled", () => {
    const values = [10, 14, 20, 23]
    const timing = { now: () => values.shift() ?? 0 }

    expect(startPerformance(timing)).toBeUndefined()
    Reflect.set(globalThis, "__opencodexPerformanceEnabled", true)
    finishPerformance("operation", startPerformance(timing), timing)
    finishPerformance("operation", startPerformance(timing), timing)

    expect(performanceSummaries()).toEqual({
      operation: { count: 2, totalDuration: 7, maxDuration: 4, lastDuration: 3 },
    })
    recordPerformanceDetail("sync", { commits: 2 })
    expect(Reflect.get(globalThis, "__opencodexPerformanceDetails")).toEqual({ sync: { commits: 2 } })
  })
})
