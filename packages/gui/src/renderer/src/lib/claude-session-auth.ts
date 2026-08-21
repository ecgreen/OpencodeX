/**
 * Reads the headless Claude driver's per-session auth state out of session
 * metadata. Mirrors `packages/opencode/src/opencodex/claude-driver-metadata.ts`;
 * kept as a plain reader so the renderer needs no server imports.
 *
 * This replaces an earlier reader that looked for a `claudeDriver` key no
 * server ever wrote, so the sign-in banner it fed could never render.
 */
export type ClaudeSessionAuthState = "ready" | "needs-login"

export function claudeSessionAuthState(metadata: unknown): ClaudeSessionAuthState | undefined {
  if (!record(metadata)) return undefined
  const value = metadata.claudeCode
  if (!record(value)) return undefined
  // Matches the server's own guard: a record is only a conversation once a turn
  // has launched the CLI or Claude has issued an id.
  if (value.launched !== true && typeof value.conversationID !== "string") return undefined
  if (value.authState !== "ready" && value.authState !== "needs-login") return undefined
  return value.authState
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
