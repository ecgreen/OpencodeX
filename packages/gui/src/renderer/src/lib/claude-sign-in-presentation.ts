import type { ClaudeAuthPhase } from "../controllers/claude-auth-controller"

/**
 * Button copy and disabled state for the sign-in banners. Extracted the way
 * `terminal-presentation.ts` extracts the other Claude terminal's labels, so
 * the wording is testable without rendering a component.
 */
export function claudeSignInLabel(phase: ClaudeAuthPhase) {
  if (phase === "signing-in") return "Signing in..."
  if (phase === "checking") return "Checking..."
  if (phase === "failed") return "Try again"
  return "Sign in"
}

/** Only an attempt actually in flight blocks another; a failure must be retryable. */
export function claudeSignInBusy(phase: ClaudeAuthPhase) {
  return phase === "signing-in" || phase === "checking"
}
