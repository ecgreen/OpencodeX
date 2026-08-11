import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Button, Dialog, DialogFooter, IconButton, TextArea } from "./ui"
import { Icon } from "./icon"

export function ComposerDeliveryActions(props: {
  running: boolean
  disabled: boolean
  disconnectedProviderName?: string
}) {
  return (
    <Show
      when={props.running}
      fallback={
        <Button
          appearance="ghost"
          class="send-button"
          type="submit"
          title={props.disconnectedProviderName ? `Connect ${props.disconnectedProviderName} to send` : "Send message"}
          aria-label="Send message"
          disabled={props.disabled}
        >
          <Icon name="cursorArrow" />
        </Button>
      }
    >
      <div class="composer-delivery-actions" aria-label="Choose how to deliver this message">
        <Button appearance="outline" size="compact" type="submit" name="delivery" value="direct" leadingIcon="send" title="Interrupt the current response and send now (Ctrl+Enter)" aria-keyshortcuts="Control+Enter" disabled={props.disabled}>
          Direct
        </Button>
        <Button appearance="solid" tone="accent" size="compact" type="submit" name="delivery" value="queue" leadingIcon="listTodo" title="Send when the current response finishes (Enter)" aria-keyshortcuts="Enter" disabled={props.disabled}>
          Queue
        </Button>
      </div>
    </Show>
  )
}

export function ComposerQueuedPrompts(props: {
  prompts: Array<{ id: string; text: string; input: string; hasAttachments: boolean }>
  update: (id: string, value: string) => void
  remove: (id: string) => void
  hold?: (held: boolean) => void
}) {
  const [editing, setEditing] = createSignal<(typeof props.prompts)[number]>()
  const [editValue, setEditValue] = createSignal("")
  const [removing, setRemoving] = createSignal<(typeof props.prompts)[number]>()
  // An open dialog holds auto-send so the message being edited cannot be
  // delivered out from under the user when the current run finishes.
  createEffect(() => props.hold?.(Boolean(editing()) || Boolean(removing())))
  onCleanup(() => props.hold?.(false))
  // If the item still leaves the queue (sent directly, removed elsewhere),
  // close its dialog instead of editing a message that no longer exists.
  createEffect(() => {
    const ids = new Set(props.prompts.map((item) => item.id))
    if (editing() && !ids.has(editing()!.id)) setEditing()
    if (removing() && !ids.has(removing()!.id)) setRemoving()
  })
  const openEditor = (item: (typeof props.prompts)[number]) => {
    setEditing(item)
    setEditValue(item.input)
  }
  const closeEditor = () => setEditing()
  const saveEdit = () => {
    const item = editing()
    const value = editValue().trim()
    if (!item || (!value && !item.hasAttachments)) return
    props.update(item.id, value)
    closeEditor()
  }
  return (
    <>
      <Show when={props.prompts.length > 0}>
        <section class="composer-queued-prompts" aria-label={`${props.prompts.length} queued message${props.prompts.length === 1 ? "" : "s"}`}>
          <div class="composer-queued-heading" aria-live="polite">
            <span>Up next</span>
            <span class="composer-queued-count">{props.prompts.length}</span>
          </div>
          <div class="composer-queued-list">
            <For each={props.prompts}>
              {(item, index) => (
                <div class="composer-queued-prompt">
                  <span class="composer-queued-index">{index() + 1}</span>
                  <span class="composer-queued-text" title={item.text}>{item.text}</span>
                  <div class="composer-queued-actions">
                    <IconButton appearance="ghost" size="compact" icon="pencil" label={`Edit queued message ${index() + 1}`} tooltip="Edit queued message" onClick={() => openEditor(item)} />
                    <IconButton appearance="ghost" tone="danger" size="compact" icon="x" label={`Remove queued message ${index() + 1}`} tooltip="Remove queued message" onClick={() => setRemoving(item)} />
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
      <Dialog
        open={Boolean(editing())}
        onClose={closeEditor}
        title="Edit queued message"
        description={editing()?.hasAttachments ? "Attached context will remain with this message." : "Update this message without changing its place in the queue."}
        size="sm"
        onSubmit={() => saveEdit()}
        footer={
          <DialogFooter align="end">
            <Button appearance="ghost" onClick={closeEditor}>Cancel</Button>
            <Button appearance="solid" tone="accent" type="submit" disabled={!editValue().trim() && !editing()?.hasAttachments}>Save changes</Button>
          </DialogFooter>
        }
      >
        <TextArea label="Message" value={editValue()} rows={6} autofocus onInput={(event) => setEditValue(event.currentTarget.value)} />
      </Dialog>
      <Dialog
        open={Boolean(removing())}
        onClose={() => setRemoving()}
        title="Remove queued message?"
        description="This message will not be sent when the current task finishes."
        size="sm"
        dismissible={false}
        footer={
          <DialogFooter align="end">
            <Button appearance="ghost" onClick={() => setRemoving()}>Cancel</Button>
            <Button
              appearance="solid"
              tone="danger"
              onClick={() => {
                const item = removing()
                if (item) props.remove(item.id)
                setRemoving()
              }}
            >
              Remove message
            </Button>
          </DialogFooter>
        }
      >
        <p class="composer-queued-remove-preview">{removing()?.text}</p>
      </Dialog>
    </>
  )
}
