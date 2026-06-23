import type { Accessor, ComponentProps } from "solid-js"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Icon } from "./icon"
import { WorkbenchAssistantPanel } from "./workbench-assistant-panel"
import { WorkbenchEditorPanel } from "./workbench-editor-panel"
import { WorkbenchFileExplorerPanel } from "./workbench-file-explorer-panel"
import { WorkbenchOpenFileModal } from "./workbench-open-file-modal"

export function WorkbenchFilesTab(props: {
  explorerCollapsed: Accessor<boolean>
  assistantOpen: Accessor<boolean>
  explorerWidth: Accessor<number>
  assistantWidth: Accessor<number>
  startPaneResize: (kind: "explorer" | "assistant", event: PointerEvent & { currentTarget: HTMLElement }) => void
  explorer: ComponentProps<typeof WorkbenchFileExplorerPanel>
  editor: ComponentProps<typeof WorkbenchEditorPanel>
  assistant?: ComponentProps<typeof WorkbenchAssistantPanel>
  openFileModalOpen: Accessor<boolean>
  openFileModal?: ComponentProps<typeof WorkbenchOpenFileModal>
}) {
  const [assistantRendered, setAssistantRendered] = createSignal(props.assistantOpen())
  const [assistantClosing, setAssistantClosing] = createSignal(false)
  let closeTimer: number | undefined

  createEffect(() => {
    if (props.assistantOpen()) {
      if (closeTimer) window.clearTimeout(closeTimer)
      setAssistantRendered(true)
      setAssistantClosing(false)
      return
    }
    if (!assistantRendered()) return
    setAssistantClosing(true)
    closeTimer = window.setTimeout(() => {
      setAssistantRendered(false)
      setAssistantClosing(false)
    }, 190)
  })

  onCleanup(() => {
    if (closeTimer) window.clearTimeout(closeTimer)
  })

  return (
    <div
      class="workbench-files"
      classList={{
        "explorer-collapsed": props.explorerCollapsed(),
        "assistant-open": assistantRendered(),
        "assistant-closing": assistantClosing(),
      }}
      style={`--workbench-sidebar-width:${props.explorerWidth()}px;--workbench-assistant-width:${props.assistantWidth()}px;`}
    >
      <WorkbenchFileExplorerPanel {...props.explorer} />
      <Show when={!props.explorerCollapsed()}>
        <div
          class="workbench-resize-handle explorer"
          role="separator"
          aria-label="Resize file explorer"
          onPointerDown={(event) => props.startPaneResize("explorer", event)}
        >
          <Icon name="grip" />
        </div>
      </Show>
      <WorkbenchEditorPanel {...props.editor} />
      <Show when={assistantRendered() && props.assistant}>
        {(assistant) => (
          <>
            <div
              class="workbench-resize-handle assistant"
              role="separator"
              aria-label="Resize assistant panel"
              onPointerDown={(event) => props.startPaneResize("assistant", event)}
            >
              <Icon name="grip" />
            </div>
            <WorkbenchAssistantPanel {...assistant()} />
          </>
        )}
      </Show>
      <Show when={props.openFileModalOpen() && props.openFileModal}>
        {(modal) => <WorkbenchOpenFileModal {...modal()} />}
      </Show>
    </div>
  )
}
