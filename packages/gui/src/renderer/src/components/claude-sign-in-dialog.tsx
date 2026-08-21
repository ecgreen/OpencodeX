import { Show, createEffect, onCleanup } from "solid-js"
import type { createClaudeAuthController } from "../controllers/claude-auth-controller"
import { terminalSurface } from "./session-side-terminal-views"
import { Button, Dialog, InlineNotice } from "./ui"
import styles from "./claude-sign-in-dialog.module.css"

/**
 * Hosts the `claude auth login` PTY. The CLI opens a browser for the OAuth
 * round trip and reports the outcome in this pane, so the terminal is the
 * surface rather than an implementation detail hidden behind a spinner.
 *
 * The controller owns the PTY: it already subscribes to `onData`/`onExit`,
 * calls `terminalSurface.ensure(...)` for every byte the shell writes, and
 * disposes the view on `close()` once the PTY destroy settles. This dialog's
 * only job is to attach that existing view to a DOM host while it is open,
 * and detach (never dispose) when it closes or unmounts. The `write`/`openURL`
 * passed to `attach` below are not a second, divergent wiring - they are the
 * same real callbacks the controller's own default deps use, needed only
 * because `attach`'s first call for a given id is the one that constructs the
 * view (via `ensure`) if no PTY byte has arrived yet.
 */
export function ClaudeSignInDialog(props: { controller: ReturnType<typeof createClaudeAuthController> }) {
  let host: HTMLDivElement | undefined
  createEffect(() => {
    if (!props.controller.isOpen() || !host) return
    const detach = terminalSurface.attach(
      props.controller.terminalID,
      host,
      (id, data) => window.opencodex?.terminal?.write({ id, data }),
      (url) => void window.opencodex?.browser?.external(url),
      true,
    )
    onCleanup(detach)
  })
  return (
    <Dialog
      open={props.controller.isOpen()}
      onClose={props.controller.close}
      size="lg"
      title="Sign in to Claude Code"
      description="Complete the sign-in below. Your browser opens to finish the OAuth flow."
      footer={
        <Button appearance="outline" type="button" onClick={props.controller.close}>
          Done
        </Button>
      }
    >
      <div class={styles.host} ref={(element) => (host = element)} />
      <Show when={props.controller.message()}>
        {(text) => <InlineNotice tone="danger">{text()}</InlineNotice>}
      </Show>
    </Dialog>
  )
}
