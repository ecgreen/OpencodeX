import { Show } from "solid-js"
import type { MessageBundle } from "../lib/store"
import { messageActionAvailability, type SessionMessageActionKind } from "../lib/message-actions"
import { IconButton } from "./ui"

export function MessageActions(props: {
  bundle: MessageBundle
  pending: boolean
  onAction: (action: SessionMessageActionKind, bundle: MessageBundle) => void
}) {
  const availability = () => messageActionAvailability(props.bundle, props.pending)
  return (
    <div class="message-actions">
      <Show when={availability().copy}>
        <IconButton appearance="ghost" size="compact" icon="copy" label="Copy message" tooltip="Copy message" onClick={() => props.onAction("copy", props.bundle)} />
      </Show>
      <Show when={availability().retry}>
        <IconButton appearance="ghost" size="compact" icon="refresh" label="Retry from this message" tooltip="Retry from this message" onClick={() => props.onAction("retry", props.bundle)} />
      </Show>
      <Show when={availability().edit}>
        <IconButton appearance="ghost" size="compact" icon="pencil" label="Edit and resubmit" tooltip="Edit and resubmit" onClick={() => props.onAction("edit", props.bundle)} />
      </Show>
      <Show when={availability().fork}>
        <IconButton appearance="ghost" size="compact" icon="github" label="Fork session from here" tooltip="Fork session from here" onClick={() => props.onAction("fork", props.bundle)} />
      </Show>
    </div>
  )
}
