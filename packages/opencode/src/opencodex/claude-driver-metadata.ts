/**
 * Per-session state for the headless Claude Code driver, stored in the
 * session's free-form `metadata`. It lives in its own dependency-free module so
 * both the session loop and the GUI can read it without importing the driver.
 */

export const METADATA_KEY = "claudeCode"

export type AuthState = "ready" | "needs-login"

export type Conversation = {
  /**
   * The conversation id Claude issued, reused across turns to resume in place.
   * Absent until a turn has reported one - an id OpencodeX made up cannot be
   * resumed, and trying fails the turn outright.
   */
  conversationID?: string
  /** False until a turn has actually spawned the CLI once. */
  launched: boolean
  modelID?: string
  authState?: AuthState
  /** Cumulative spend Claude has reported, so per-turn cost is a delta. */
  billed?: { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readConversation(metadata: Record<string, unknown> | undefined): Conversation | undefined {
  const value = metadata?.[METADATA_KEY]
  if (!record(value)) return undefined
  if (value.launched !== true && typeof value.conversationID !== "string") return undefined
  return {
    ...(typeof value.conversationID === "string" ? { conversationID: value.conversationID } : {}),
    launched: value.launched === true,
    ...(typeof value.modelID === "string" ? { modelID: value.modelID } : {}),
    ...(value.authState === "ready" || value.authState === "needs-login" ? { authState: value.authState } : {}),
    ...(isBilled(value.billed) ? { billed: value.billed } : {}),
  }
}

export function withConversation(
  metadata: Record<string, unknown> | undefined,
  conversation: Conversation,
): Record<string, unknown> {
  return { ...metadata, [METADATA_KEY]: conversation }
}

export function authState(metadata: Record<string, unknown> | undefined) {
  return readConversation(metadata)?.authState
}

function isBilled(value: unknown): value is Conversation["billed"] {
  if (!record(value)) return false
  return ["cost", "input", "output", "cacheRead", "cacheWrite"].every((key) => typeof value[key] === "number")
}

export * as ClaudeDriverMetadata from "./claude-driver-metadata"
