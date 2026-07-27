export type EnvironmentCeiling = {
  local: number
  ci: number
}

export type PerformanceBudgets = {
  enforced: {
    initialRootRequests: number
    initialCardRequests: number
    initialCards: number
    catalogCards: number
    initialResponseBytes: number
    initialDomElements: number
    initialSessionRows: number
    idleLongTaskMs: number
    coldSwitchSamples: number
    coldSwitchRequests: number
    coldSwitchP95Ms: EnvironmentCeiling
    cachedSwitchRequests: number
    cachedSwitchPaintMs: EnvironmentCeiling
    warmRoutePaintMs: EnvironmentCeiling
    transcriptMessages: number
    messagesAfterLoadMore: number
    loadMoreAnchorDriftCssPx: number
    largePreviewDomElements: number
    inactiveSessionDetails: number
  }
  aspirational: {
    coldSwitchPaintMs: number
    cachedSwitchPaintMs: number
  }
}

// Enforced ceilings are calibrated regression limits, not product aspirations. Keep
// them conservative enough for shared CI hosts and tighten only from repeated runs.
export const PERFORMANCE_BUDGETS = {
  enforced: {
    initialRootRequests: 1,
    initialCardRequests: 0,
    initialCards: 100,
    catalogCards: 250,
    initialResponseBytes: 96 * 1024,
    initialDomElements: 800,
    initialSessionRows: 5,
    idleLongTaskMs: 50,
    coldSwitchSamples: 5,
    coldSwitchRequests: 1,
    coldSwitchP95Ms: { local: 700, ci: 1_800 },
    cachedSwitchRequests: 0,
    cachedSwitchPaintMs: { local: 200, ci: 600 },
    warmRoutePaintMs: { local: 200, ci: 600 },
    transcriptMessages: 128,
    messagesAfterLoadMore: 512,
    loadMoreAnchorDriftCssPx: 1,
    largePreviewDomElements: 15_000,
    inactiveSessionDetails: 16,
  },
  // Targets remain visible in every report but do not fail heterogeneous CI hardware.
  aspirational: {
    coldSwitchPaintMs: 100,
    cachedSwitchPaintMs: 50,
  },
} as const satisfies PerformanceBudgets

export function environmentCeiling(value: EnvironmentCeiling) {
  return process.env.CI ? value.ci : value.local
}
