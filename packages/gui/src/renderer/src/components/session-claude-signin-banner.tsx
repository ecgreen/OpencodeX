import type { Session } from "@opencode-ai/sdk/v2/client"
import { Show, createMemo } from "solid-js"
import { claudeSessionAuthState } from "../lib/claude-session-auth"
import type { MessageBundle } from "../lib/session-api"
import { Button, InlineNotice } from "./ui"

/**
 * Extracted from `session-page.tsx` so that file stays inside the
 * design-system size budget.
 *
 * A Claude Code session cannot run headlessly until the CLI is signed in.
 * Session metadata only flips back to `ready` on the next successful turn, so
 * once a sign-in is confirmed this banner is what invites that turn to
 * happen, targeting the last assistant message via the retry action.
 */
export function SessionClaudeSignInBanner(props: {
  session: Session | undefined
  messages: MessageBundle[]
  claudeSignInConfirmed?: boolean
  signInToClaude?: () => void
  retry: (bundle: MessageBundle) => void
}) {
  const claudeNeedsLogin = createMemo(() => claudeSessionAuthState(props.session?.metadata) === "needs-login")
  const lastAssistant = createMemo(() => props.messages.findLast((message) => message.info.role === "assistant"))
  return (
    <Show when={claudeNeedsLogin()}>
      <InlineNotice
        tone={props.claudeSignInConfirmed ? "success" : "warning"}
        title={props.claudeSignInConfirmed ? "Signed in to Claude Code" : "Claude Code sign-in expired"}
      >
        <Show
          when={props.claudeSignInConfirmed}
          fallback={<p>This session cannot run until Claude Code is signed in again.</p>}
        >
          <p>Retry the message that failed to continue where you left off.</p>
        </Show>
        <Show when={props.claudeSignInConfirmed ? lastAssistant() : undefined} fallback={
          <Show when={props.signInToClaude}>
            {(signIn) => (
              <Button appearance="outline" size="compact" onClick={() => signIn()()}>
                Sign in to Claude Code
              </Button>
            )}
          </Show>
        }>
          {(bundle) => (
            <Button appearance="outline" size="compact" onClick={() => props.retry(bundle())}>
              Retry
            </Button>
          )}
        </Show>
      </InlineNotice>
    </Show>
  )
}
