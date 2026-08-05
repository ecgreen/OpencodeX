import { Show } from "solid-js"
import type { SessionData } from "../lib/session-api"
import { Button } from "./ui"

/**
 * Why an embedded transcript has nothing in it.
 *
 * A read-only pane has no composer and no empty state, so without this a failed
 * load and a step that genuinely has not said anything yet look identical: an
 * empty box. Both are worth naming, and a failed load is worth a retry - it is
 * the only way back, since nothing re-schedules a load that already failed.
 */
export function EmbeddedSessionStatus(props: {
  sessionID: string
  data?: SessionData
  loading: boolean
  error?: string
  retry?: (sessionID: string) => void
}) {
  const empty = () => !props.loading && !props.error && (props.data?.messages.length ?? 0) === 0
  return (
    <>
      <Show when={props.error}>
        {(message) => (
          <div class="embedded-session-status error" role="alert">
            <span>Could not load this step: {message()}</span>
            <Show when={props.retry}>
              {(retry) => (
                <Button appearance="outline" size="compact" onClick={() => retry()(props.sessionID)}>
                  Try again
                </Button>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={empty()}>
        <p class="embedded-session-status" role="status">
          Nothing here yet - this step has not produced any messages.
        </p>
      </Show>
    </>
  )
}
