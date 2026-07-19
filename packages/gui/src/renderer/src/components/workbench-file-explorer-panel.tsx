import type { Accessor, Setter } from "solid-js"
import { For, Show } from "solid-js"
import type { FileNode } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchGitStatus } from "../lib/store"
import type { WorkbenchProjectScope, WorkbenchTreeRow } from "../lib/workbench"
import { workbenchPathKey } from "../lib/workbench"
import { Icon } from "./icon"
import { TextInput, Button, Select } from "./ui"

export function WorkbenchFileExplorerPanel(props: {
  collapsed: Accessor<boolean>
  setCollapsed: Setter<boolean>
  canUseWorkspace: Accessor<boolean>
  selectedDirectory: Accessor<string>
  startNewFile: () => void
  startNewFolder: () => void
  projectOptions: Accessor<WorkbenchProjectScope[]>
  selectedProjectID: Accessor<string>
  selectProject: (value: string) => void
  filter: Accessor<string>
  setFilter: Setter<string>
  openFilePalette: () => void
  newFilePath: Accessor<string>
  newItemKind: Accessor<"file" | "folder">
  setNewFilePath: Setter<string>
  filePath: Accessor<string>
  setNewFileInput: (element: HTMLInputElement) => void
  createExplorerItem: () => void
  searchState: Accessor<"idle" | "loading" | "error">
  matches: Accessor<FileNode[]>
  openPath: Accessor<string>
  dirtyPaths: Accessor<Set<string>>
  gitStatusByPath: Accessor<Map<string, WorkbenchGitStatus["files"][number]>>
  toggleFolder: (node: FileNode) => void
  openFile: (path: string) => void
  rows: Accessor<WorkbenchTreeRow[]>
  busy: Accessor<string>
  gitStatusSymbol: (file: WorkbenchGitStatus["files"][number]) => string
}) {
  return (
    <>
      <Show when={props.collapsed()}>
        <Button appearance="ghost"
          type="button"
          class="workbench-sidebar-restore"
          aria-label="Show file explorer"
          title="Show file explorer"
          onClick={() => props.setCollapsed(false)}
        >
          <Icon name="folder" />
          <span>Files</span>
        </Button>
      </Show>
      <Show when={!props.collapsed()}>
        <aside class="workbench-sidebar">
          <header class="workbench-explorer-header">
            <div><span>Workspace</span></div>
            <div class="workbench-icon-actions">
              <Button appearance="ghost" type="button" disabled={!props.canUseWorkspace()} aria-label="New file" title="New file" onClick={props.startNewFile}><Icon name="file" /></Button>
              <Button appearance="ghost" type="button" disabled={!props.canUseWorkspace()} aria-label="New folder" title="New folder" onClick={props.startNewFolder}><Icon name="folder" /></Button>
              <Button appearance="ghost" type="button" aria-label="Hide explorer" title="Hide explorer" onClick={() => props.setCollapsed(true)}><Icon name="panel" /></Button>
            </div>
          </header>
          <Select<WorkbenchProjectScope>
            class="workbench-project-picker"
            label="Project"
            options={props.projectOptions()}
            current={props.projectOptions().find((project) => project.id === props.selectedProjectID())}
            optionValue={(project) => project.id}
            optionLabel={(project) => project.label}
            onSelect={(project) => project && props.selectProject(project.id)}
          />
          <div class="workbench-filter-row">
            <div class="workbench-filter">
              <Icon name="search" />
              <TextInput type="search" aria-label="Filter file tree" value={props.filter()} placeholder="Filter tree" onInput={(event) => props.setFilter(event.currentTarget.value)} />
              <Show when={props.filter()}>
                <Button appearance="ghost" type="button" aria-label="Clear file filter" onClick={() => props.setFilter("")}><Icon name="x" /></Button>
              </Show>
            </div>
            <Button appearance="ghost" type="button" class="workbench-open-file-trigger" aria-label="Open file by name" title="Open file by name" onClick={props.openFilePalette}>
              <Icon name="file" />
            </Button>
          </div>
          <Show when={props.newFilePath()}>
            <div class="workbench-new-file">
              <TextInput
                ref={props.setNewFileInput}
                value={props.newFilePath()}
                placeholder={newItemPlaceholder(props.filePath(), props.newItemKind())}
                onInput={(event) => props.setNewFilePath(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  props.createExplorerItem()
                }}
              />
              <Button appearance="ghost" type="button" disabled={!props.canUseWorkspace() || !props.newFilePath().trim()} onClick={props.createExplorerItem}><Icon name="plus" /> {props.newItemKind() === "folder" ? "Folder" : "File"}</Button>
              <Button appearance="ghost" type="button" aria-label="Cancel create" onClick={() => props.setNewFilePath("")}><Icon name="x" /></Button>
            </div>
          </Show>
          <Show when={props.filter().trim().length >= 2}>
            <WorkbenchSearchResults {...props} />
          </Show>
          <WorkbenchFileTree {...props} />
        </aside>
      </Show>
    </>
  )
}

function WorkbenchSearchResults(props: Parameters<typeof WorkbenchFileExplorerPanel>[0]) {
  return (
    <div class="workbench-search-results">
      <header>
        <span>Project matches</span>
        <small>{props.searchState() === "loading" ? "Searching..." : props.searchState() === "error" ? "Search failed" : `${props.matches().length} found`}</small>
      </header>
      <For each={props.matches()} fallback={<div class="empty">{props.searchState() === "loading" ? "Searching project..." : "No project matches."}</div>}>
        {(match) => (
          <Button appearance="ghost"
            type="button"
            class="workbench-search-row"
            classList={{ selected: props.openPath() === match.path, directory: match.type === "directory" }}
            onClick={() => match.type === "directory" ? props.toggleFolder(match) : props.openFile(match.path)}
          >
            <Icon name={match.type === "directory" ? "folder" : "file"} />
            <span>{match.path}</span>
            <WorkbenchFileBadges path={match.path} isFile={match.type === "file"} {...props} />
          </Button>
        )}
      </For>
    </div>
  )
}

function WorkbenchFileTree(props: Parameters<typeof WorkbenchFileExplorerPanel>[0]) {
  return (
    <div class="workbench-tree" role="tree">
      <For each={props.rows()} fallback={<div class="empty">{props.busy() === "files" ? "Loading files..." : "No files found."}</div>}>
        {(row) => (
          <Button appearance="ghost"
            type="button"
            class="workbench-file-row"
            classList={{ selected: props.openPath() === row.node.path, directory: row.node.type === "directory", expanded: row.expanded }}
            style={{ "--depth": String(row.depth) }}
            role="treeitem"
            aria-expanded={row.node.type === "directory" ? row.expanded : undefined}
            onClick={() => row.node.type === "directory" ? props.toggleFolder(row.node) : props.openFile(row.node.path)}
          >
            <Show when={row.node.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
              <span class="workbench-disclosure"><Icon name={row.expanded ? "chevronDown" : "chevronRight"} /></span>
            </Show>
            <Icon name={row.node.type === "directory" ? row.expanded ? "folder-open" : "folder" : "file"} />
            <span>{row.node.name}</span>
            <WorkbenchFileBadges path={row.node.path} isFile={row.node.type === "file"} {...props} />
            <Show when={row.node.type === "directory" && row.expanded && !row.loaded}>
              <span class="workbench-loading">...</span>
            </Show>
          </Button>
        )}
      </For>
    </div>
  )
}

function WorkbenchFileBadges(props: Parameters<typeof WorkbenchFileExplorerPanel>[0] & { path: string; isFile: boolean }) {
  return (
    <>
      <Show when={props.isFile && props.dirtyPaths().has(workbenchPathKey(props.path))}>
        <span class="workbench-dirty-status" title="Unsaved editor changes" />
      </Show>
      <Show when={props.gitStatusByPath().get(workbenchPathKey(props.path))}>
        {(file) => <span class={`workbench-tree-status ${file().status}`} title={file().staged ? "Staged" : file().untracked ? "New file" : "Modified"}>{props.gitStatusSymbol(file())}</span>}
      </Show>
    </>
  )
}

function newItemPlaceholder(path: string, kind: "file" | "folder") {
  if (kind === "folder") return path ? `${path}/new-folder` : "new-folder"
  return path ? `${path}/new-file.ts` : "new-file.ts"
}
