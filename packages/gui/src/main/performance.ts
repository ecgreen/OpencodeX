import { performance } from "node:perf_hooks"

export const MAIN_PERFORMANCE_MILESTONES = {
  bootstrap: "opencodex.main.bootstrap",
  appReady: "opencodex.main.app-ready",
  windowCreateStarted: "opencodex.main.window-create-started",
  windowCreated: "opencodex.main.window-created",
  rendererLoadStarted: "opencodex.main.renderer-load-started",
  rendererLoaded: "opencodex.main.renderer-loaded",
  sidecarRequestStarted: "opencodex.main.sidecar-request-started",
  sidecarReady: "opencodex.main.sidecar-ready",
} as const

export type MainPerformanceMilestone = (typeof MAIN_PERFORMANCE_MILESTONES)[keyof typeof MAIN_PERFORMANCE_MILESTONES]

const timestamps = new Map<MainPerformanceMilestone, number>()

export function markMainPerformance(name: MainPerformanceMilestone) {
  const timestamp = performance.now()
  timestamps.set(name, timestamp)
  if (process.env.OPENCODEX_GUI_PERFORMANCE === "1") {
    console.info("[opencodex:performance]", JSON.stringify({ name, timestamp }))
  }
  return timestamp
}

export function mainPerformanceTimestamps() {
  return Object.fromEntries(timestamps)
}
