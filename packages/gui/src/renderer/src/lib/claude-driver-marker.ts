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
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readClaudeDriverMarker(metadata: unknown): ClaudeDriverMarker | undefined {
  if (!record(metadata)) return undefined
  const value = metadata.claudeDriver
  if (!record(value)) return undefined
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
