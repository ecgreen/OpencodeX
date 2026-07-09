import type { OpencodeXSessionUiState } from "@opencode-ai/sdk/v2"

export function markViewedSessionUiState(
  sessionID: string,
  current: OpencodeXSessionUiState | undefined,
  time: number,
  sessionUpdated = 0,
): OpencodeXSessionUiState {
  return {
    sessionID,
    seenAt: Math.max(time, current?.seenAt ?? 0),
    ...(current?.reviewedAt === undefined ? {} : { reviewedAt: current.reviewedAt }),
    reviewedFiles: current?.reviewedFiles ?? [],
    displayStatus: current?.displayStatus ?? "idle",
    updated: sessionUpdated > time,
  }
}
