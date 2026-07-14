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
  matches: FileNode[]
  rows: WorkbenchTreeRow[]
  loading: boolean
  openPath: string
  toggleFolder: (node: FileNode) => void
  openFile: (path: string) => void
  close: () => void
}) {
  return (
    <section class="session-open-file-explorer" aria-label="Workspace files">
      <header>
        <div>
          <strong>Workspace files</strong>
          <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
        </div>
        <button type="button" aria-label="Close file explorer" onClick={props.close}><Icon name="x" /></button>
      </header>
      <div class="workbench-filter">
        <Icon name="search" />
        <input value={props.filter} placeholder="Filter files" onInput={(event) => props.setFilter(event.currentTarget.value)} />
        <Show when={props.filter}>
          <button type="button" aria-label="Clear file filter" onClick={() => props.setFilter("")}><Icon name="x" /></button>
        </Show>
      </div>
      <Show when={props.filter.trim().length >= 2}>
        <div class="workbench-search-results">
          <header>
            <span>Project matches</span>
            <small>{props.searchState === "loading" ? "Searching..." : props.searchState === "error" ? "Search failed" : `${props.matches.length} found`}</small>
          </header>
          <For each={props.matches} fallback={<div class="empty">{props.searchState === "loading" ? "Searching project..." : "No project matches."}</div>}>
            {(match) => (
              <button
                type="button"
                class="workbench-search-row"
                classList={{ selected: props.openPath === match.path, directory: match.type === "directory" }}
                onClick={() => match.type === "directory" ? props.toggleFolder(match) : props.openFile(match.path)}
              >
                <Icon name={match.type === "directory" ? "folder" : "file"} />
                <span>{match.path}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="workbench-tree" role="tree">
        <For each={props.rows} fallback={<div class="empty">{props.loading ? "Loading files..." : "No files found."}</div>}>
          {(row) => (
            <button
              type="button"
              class="workbench-file-row"
              classList={{ selected: props.openPath === row.node.path, directory: row.node.type === "directory", expanded: row.expanded, root: row.depth === 0 }}
              style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}
              role="treeitem"
              aria-expanded={row.node.type === "directory" ? row.expanded : undefined}
              onClick={() => row.node.type === "directory" ? props.toggleFolder(row.node) : props.openFile(row.node.path)}
            >
              <Show when={row.node.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
                <span class="workbench-disclosure"><Icon name={row.expanded ? "chevronDown" : "chevronRight"} /></span>
              </Show>
              <Icon name={row.node.type === "directory" ? row.expanded ? "folder-open" : "folder" : "file"} />
              <span>{row.node.name}</span>
              <Show when={row.node.type === "directory" && row.expanded && !row.loaded}>
                <span class="workbench-loading">...</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}
