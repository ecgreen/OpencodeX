/**
 * Recognizes a Claude Code CLI failure that means "the user has to sign in
 * again", from either the CLI's own `result` error text or an SDK throw.
 *
 * Pure by design: the mapper is a pure projection and the driver runs inside
 * Effect, and both need this verdict. Keeping it here also means the patterns
 * can be tested directly against real CLI output.
 */

export type ClaudeAuthFailure = {
  kind: "auth-expired" | "auth-missing"
  /** Replaces the raw CLI text as the message the reader sees. */
  message: string
}

/** Sufficient alone: the CLI only emits these when auth is the problem. */
const STRONG = [
  /oauth session expired/i,
  /could not be refreshed/i,
  // The CLI's real text backticks the command - `` Please run `/login` `` -
  // so the slash and the word are each optionally wrapped in a backtick.
  /please run\s+`?\/?login`?/i,
  /not logged in/i,
  /invalid api[- ]key/i,
]

/**
 * Individually far too weak - a model can end a failed turn with prose about a
 * "session" that "expired" - so a credential noun and a failure verb both have
 * to appear before this counts as an auth failure. Callers that can tell a
 * genuine CLI failure from ordinary model prose (see `weakTierAllowed` below)
 * gate this tier off entirely rather than relying on wording alone.
 */
// "api key" and "api-key" both appear in CLI text; the 401 JSON body Claude
// actually emits spells it "x-api-key" with no space at all.
const CREDENTIAL = /\b(oauth|token|credentials?|(?:x-)?api[- ]key)\b/i
const FAILURE =
  /\b(expired|revoked|invalid|unauthorized|failed to authenticate|authentication failed|authentication_error)\b/i

/** Distinguishes a credential that went bad from one that was never there. */
const LOST = /\b(expired|revoked)\b|could not be refreshed/i

const RECOVERY =
  'Sign in again to continue - in the desktop app use "Sign in to Claude Code", or run `claude auth login` in a terminal - then retry this message.'

/**
 * `weakTierAllowed` defaults true for the SDK-throw caller (`claude-driver.ts`),
 * which has no `is_error` to check against. The `result`-text caller
 * (`claude-mapper.ts`) passes `false` for events whose failure is only implied
 * by a non-"success" subtype, not by `is_error` itself - `error_max_turns` can
 * carry the model's own final prose as `result`, and that prose can happen to
 * mention a credential noun and a failure verb without being an auth failure
 * at all.
 */
export function classifyClaudeError(
  raw: string,
  options: { weakTierAllowed?: boolean } = {},
): ClaudeAuthFailure | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const weakTierAllowed = options.weakTierAllowed ?? true
  const weakMatch = weakTierAllowed && CREDENTIAL.test(text) && FAILURE.test(text)
  if (!STRONG.some((pattern) => pattern.test(text)) && !weakMatch) return undefined
  // The raw text rides along: it is the only record of what the CLI actually
  // said, and support questions are unanswerable without it.
  if (LOST.test(text))
    return { kind: "auth-expired", message: `Your Claude Code sign-in has expired. ${RECOVERY}\n\nClaude Code reported: ${text}` }
  return { kind: "auth-missing", message: `Claude Code is not signed in. ${RECOVERY}\n\nClaude Code reported: ${text}` }
}

export * as ClaudeAuthError from "./claude-auth-error"
