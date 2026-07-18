import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { Button, TextInput } from "./ui"

export function WorkbenchOpenFileModal(props: {
  projectLabel: string
  query: string
  searchState: "idle" | "loading" | "error"
  options: FileNode[]
  close: () => void
  setQuery: (value: string) => void
  openFile: (path?: string) => void
}) {
  return (
    <ModalFrame
      title="Open file"
      description={props.projectLabel}
      close={props.close}
      class="workbench-open-file-modal"
      backdropClass="dialog-backdrop workbench-open-file-backdrop"
    >
      <>
        <div class="workbench-open-file-search">
          <Icon name="search" />
          <TextInput
            value={props.query}
            placeholder="Type a file name or path..."
            onInput={(event) => props.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              props.openFile()
            }}
          />
          <Show when={props.searchState === "loading"}>
            <span class="workbench-input-status">...</span>
          </Show>
        </div>
        <div class="workbench-open-file-results" role="listbox" aria-label="Matching files">
          <For each={props.options} fallback={<div class="empty">{props.searchState === "loading" ? "Searching..." : "No matching files."}</div>}>
            {(file) => (
              <Button appearance="ghost" type="button" role="option" onClick={() => props.openFile(file.path)}>
                <Icon name={file.type === "directory" ? "folder" : "file"} />
                <span>{file.name}</span>
                <small>{file.path}</small>
            </Button>
          )}
        </For>
        </div>
      </>
    </ModalFrame>
  )
}
