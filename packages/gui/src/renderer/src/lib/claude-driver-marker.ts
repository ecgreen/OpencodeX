export type ClaudeDriverMarker = {
  driver: "claude-code"
  terminalSessionID: string
  installationID: string
  authState?: "ready" | "needs-login"
}

/**
 * Reads the headless-driver marker the server writes into session metadata.
 * Mirrors `packages/opencode/src/opencodex/claude-driver-metadata.ts`; kept as
 * a plain reader so the renderer needs no server imports.
 */
export function readClaudeDriverMarker(metadata: unknown): ClaudeDriverMarker | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const raw = (metadata as Record<string, unknown>).claudeDriver
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  if (value.driver !== "claude-code") return undefined
  if (typeof value.terminalSessionID !== "string" || typeof value.installationID !== "string") return undefined
  return {
    driver: "claude-code",
    terminalSessionID: value.terminalSessionID,
    installationID: value.installationID,
    ...(value.authState === "ready" || value.authState === "needs-login" ? { authState: value.authState } : {}),
  }
}

export function isClaudeDriverSession(metadata: unknown) {
  return readClaudeDriverMarker(metadata) !== undefined
}
