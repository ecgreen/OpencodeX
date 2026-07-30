import { Show } from "solid-js"
import { ModalFrame } from "./modal-frame"
import { Button } from "./ui"
import type { OpenTab } from "./session-side-open-types"

/**
 * Asks what to do with unsaved edits when a file tab is closed.
 *
 * The old behaviour refused the close and left a message saying to save or
 * discard first, which named neither the file nor a way to do either. This
 * names the file and performs whichever the reader picks.
 */
export function SessionSideOpenDirtyDialog(props: {
  tab?: OpenTab
  resolve: (action: "save" | "discard" | "cancel") => void
}) {
  return (
    <Show when={props.tab}>
      {(tab) => (
        <ModalFrame
          title="Unsaved changes"
          description={`${tab().title || tab().path || "This file"} has changes that have not been saved.`}
          class="dialog-card session-open-dirty-dialog"
          close={() => props.resolve("cancel")}
          // Each action is toned for its consequence: discarding is the
          // destructive one and is coloured as such without being the loudest
          // thing on screen, saving is the recommended path.
          footer={(
            <div class="dialog-actions">
              <Button appearance="ghost" onClick={() => props.resolve("cancel")}>Cancel</Button>
              <Button appearance="soft" tone="danger" leadingIcon="trash" onClick={() => props.resolve("discard")}>
                Discard changes
              </Button>
              <Button appearance="solid" tone="accent" leadingIcon="save" onClick={() => props.resolve("save")}>
                Save changes
              </Button>
            </div>
          )}
        >
          <p class="session-open-dirty-path">{tab().path}</p>
        </ModalFrame>
      )}
    </Show>
  )
}
