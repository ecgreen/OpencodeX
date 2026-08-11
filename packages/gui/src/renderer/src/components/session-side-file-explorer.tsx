import { TextInput, Button } from "./ui"
import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import type { WorkbenchTreeRow } from "../lib/workbench"
import { compactPath } from "../lib/format"
import { Icon } from "./icon"

export function SessionSideFileExplorer(props: {
  directory: string
  filter: string
  setFilter: (value: string) => void
  searchState: "idle" | "loading" | "error"
  rows: WorkbenchTreeRow[]
  loading: boolean
  openPath: string
  toggleFolder: (node: FileNode, expanded: boolean) => void
  openFile: (path: string) => void
  /** Marks files the session changed, or that have edits open and unsaved. */
  fileStatus?: (path: string) => "dirty" | "session" | undefined
  close: () => void
}) {
  return (
    <section class="session-open-file-explorer" aria-label="Workspace files">
      <header>
        <div>
          <strong>Workspace files</strong>
          <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
        </div>
        <Button appearance="ghost" type="button" aria-label="Close file explorer" onClick={props.close}><Icon name="x" /></Button>
      </header>
      <div class="workbench-filter">
        <Icon name="search" />
        <TextInput type="search" aria-label="Filter files" value={props.filter} placeholder="Filter files" onInput={(event) => props.setFilter(event.currentTarget.value)} />
        <Show when={props.filter}>
          <Button appearance="ghost" type="button" aria-label="Clear file filter" onClick={() => props.setFilter("")}><Icon name="x" /></Button>
        </Show>
      </div>
      <div class="workbench-tree" role="tree">
        <For each={props.rows} fallback={
          <div class="empty">
            {props.loading ? "Loading files..."
              : props.filter.trim().length >= 2 ? (props.searchState === "loading" ? "Searching project..." : "No matches.")
              : "No files found."}
          </div>
        }>
          {(row) => (
            <Button appearance="ghost"
              type="button"
              class="workbench-file-row"
              classList={{ selected: props.openPath === row.node.path, directory: row.node.type === "directory", expanded: row.expanded, root: row.depth === 0 }}
              style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}
              role="treeitem"
              aria-expanded={row.node.type === "directory" ? row.expanded : undefined}
              onClick={() => row.node.type === "directory" ? props.toggleFolder(row.node, row.expanded) : props.openFile(row.node.path)}
            >
              <Show when={row.node.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
                <span class="workbench-disclosure"><Icon name={row.expanded ? "chevronDown" : "chevronRight"} /></span>
              </Show>
              <Icon name={row.node.type === "directory" ? row.expanded ? "folder-open" : "folder" : "file"} />
              <span>{row.node.name}</span>
              <Show when={row.node.type !== "directory" && props.fileStatus?.(row.node.path)}>
                {(status) => (
                  <span
                    class="workbench-file-marker"
                    data-kind={status()}
                    title={status() === "dirty" ? "Unsaved changes" : "Changed in this session"}
                    aria-label={status() === "dirty" ? "Unsaved changes" : "Changed in this session"}
                  />
                )}
              </Show>
              <Show when={row.node.type === "directory" && row.expanded && !row.loaded}>
                <span class="workbench-loading">...</span>
              </Show>
            </Button>
          )}
        </For>
      </div>
    </section>
  )
}
