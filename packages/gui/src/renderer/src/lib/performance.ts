export const RENDERER_PERFORMANCE_MARKS = {
  bootstrap: "opencodex.renderer.bootstrap",
  appMounted: "opencodex.renderer.app-mounted",
  appShellMounted: "opencodex.renderer.app-shell-mounted",
  connectionStarted: "opencodex.renderer.connection-started",
  clientConnected: "opencodex.renderer.client-connected",
  stateConnected: "opencodex.renderer.state-connected",
  authoritativePainted: "opencodex.renderer.authoritative-painted",
} as const

export const RENDERER_PERFORMANCE_MEASURES = {
  bootstrapToAppMounted: "opencodex.renderer.bootstrap-to-app-mounted",
  bootstrapToAppShellMounted: "opencodex.renderer.bootstrap-to-app-shell-mounted",
  bootstrapToStateConnected: "opencodex.renderer.bootstrap-to-state-connected",
  bootstrapToAuthoritativePaint: "opencodex.renderer.bootstrap-to-authoritative-paint",
  connection: "opencodex.renderer.connection",
} as const

export const RENDERER_PERFORMANCE_OPERATIONS = {
  applyAuthoritativeState: "opencodex.renderer.apply-authoritative-state",
  reconcileSnapshot: "opencodex.renderer.reconcile-snapshot",
  projectSession: "opencodex.renderer.project-session",
} as const

export type PerformanceSummary = {
  count: number
  totalDuration: number
  maxDuration: number
  lastDuration: number
}

export type UserTiming = {
  mark?: (name: string) => unknown
  measure?: (name: string, startMark: string, endMark: string) => unknown
  now?: () => number
}

export function markPerformance(name: string, timing: UserTiming | null = browserUserTiming()) {
  if (typeof timing?.mark !== "function") return
  try {
    timing.mark(name)
  } catch {
    return
  }
}

export function measurePerformance(
  name: string,
  startMark: string,
  endMark: string,
  timing: UserTiming | null = browserUserTiming(),
) {
  if (typeof timing?.measure !== "function") return
  try {
    timing.measure(name, startMark, endMark)
  } catch {
    return
  }
}

export function startPerformance(timing: UserTiming | null = browserUserTiming()) {
  if (!performanceRecordingEnabled() || typeof timing?.now !== "function") return
  return timing.now()
}

export function finishPerformance(
  name: string,
  started: number | undefined,
  timing: UserTiming | null = browserUserTiming(),
) {
  if (started === undefined || typeof timing?.now !== "function") return
  recordPerformanceDuration(name, timing.now() - started)
}

export function performanceSummaries() {
  const value = Reflect.get(globalThis, "__opencodexPerformanceMetrics")
  return isPerformanceSummaryRecord(value) ? value : {}
}

export function recordPerformanceDetail(name: string, value: unknown) {
  if (!performanceRecordingEnabled()) return
  const current = Reflect.get(globalThis, "__opencodexPerformanceDetails")
  const details = isRecord(current) ? current : {}
  details[name] = value
  Reflect.set(globalThis, "__opencodexPerformanceDetails", details)
}

function recordPerformanceDuration(name: string, duration: number) {
  const summaries = performanceSummaries()
  const current = summaries[name]
  summaries[name] = {
    count: (current?.count ?? 0) + 1,
    totalDuration: (current?.totalDuration ?? 0) + duration,
    maxDuration: Math.max(current?.maxDuration ?? 0, duration),
    lastDuration: duration,
  }
  Reflect.set(globalThis, "__opencodexPerformanceMetrics", summaries)
}

function performanceRecordingEnabled() {
  return Reflect.get(globalThis, "__opencodexPerformanceEnabled") === true
}

function isPerformanceSummaryRecord(value: unknown): value is Record<string, PerformanceSummary> {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function browserUserTiming() {
  return (Reflect.get(globalThis, "performance") as UserTiming | undefined) ?? null
}
