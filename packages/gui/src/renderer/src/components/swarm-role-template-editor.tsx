import { Show, createSignal } from "solid-js"
import {
  swarmRoleTemplateFromDraft,
  type SwarmRoleTemplate,
} from "../lib/swarm-role-templates"
import { ModalFrame } from "./modal-frame"
import { Button, TextArea, TextInput } from "./ui"

/**
 * Creates or edits one user-defined role. Mounted on document.body because the
 * swarm editor page is itself a form and dialogs cannot nest inside it.
 */
export function SwarmRoleTemplateEditor(props: {
  template?: SwarmRoleTemplate
  /** Seeds a new template from an existing role, e.g. "save as role". */
  initial?: { name: string; instructions: string }
  save: (template: SwarmRoleTemplate) => void
  remove?: (templateID: string) => void
  close: () => void
}) {
  const [name, setName] = createSignal(props.template?.name ?? props.initial?.name ?? "")
  const [description, setDescription] = createSignal(props.template?.description ?? "")
  const [instructions, setInstructions] = createSignal(props.template?.instructions ?? props.initial?.instructions ?? "")
  const [error, setError] = createSignal("")

  function submit(event: SubmitEvent) {
    event.preventDefault()
    event.stopPropagation()
    const result = swarmRoleTemplateFromDraft({
      id: props.template?.id,
      name: name(),
      description: description(),
      instructions: instructions(),
    })
    if ("error" in result) return setError(result.error)
    props.save(result.template)
    props.close()
  }

  return (
    <ModalFrame
      title={props.template ? "Edit role" : "New role"}
      description="A saved role joins the add-a-role list beside the built-in ones. Its pre-prompt is sent ahead of every task the role is delegated."
      close={props.close}
      mount={document.body}
      onSubmit={submit}
      footer={
        <footer class="dialog-actions">
          <Show when={props.template && props.remove}>
            <Button
              appearance="ghost"
              tone="danger"
              icon="trash"
              onClick={() => {
                props.remove!(props.template!.id)
                props.close()
              }}
            >
              Delete role
            </Button>
          </Show>
          <span class="dialog-actions-spacer" />
          <Button icon="x" onClick={props.close}>Cancel</Button>
          <Button type="submit" appearance="solid" tone="accent" icon="check">
            {props.template ? "Save role" : "Create role"}
          </Button>
        </footer>
      }
    >
      <div class="swarm-role-template-fields">
        <label>
          <span>Name</span>
          <TextInput
            value={name()}
            placeholder="e.g. Data Migration Expert"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Description <em>optional</em></span>
          <TextInput
            value={description()}
            placeholder="One line for the add-a-role list"
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Pre-prompt</span>
          <TextArea
            value={instructions()}
            placeholder="What this role knows, focuses on, and must never do. Sent ahead of every task it receives."
            rows={6}
            onInput={(event) => setInstructions(event.currentTarget.value)}
          />
        </label>
        <Show when={error()}>
          <p class="swarm-role-template-error" role="alert">{error()}</p>
        </Show>
      </div>
    </ModalFrame>
  )
}
