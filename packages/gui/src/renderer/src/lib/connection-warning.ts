import type { ClientStateSyncLifecycle } from "@opencode-ai/sdk/v2"

export function shouldShowConnectionWarning(lifecycle: ClientStateSyncLifecycle | undefined) {
  return lifecycle?.status === "reconnecting" && lifecycle.data === "stale" && lifecycle.attempt >= 2
}
