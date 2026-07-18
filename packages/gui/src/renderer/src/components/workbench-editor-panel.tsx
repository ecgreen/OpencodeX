import type { Accessor, Setter } from "solid-js"
import { For, Match, Show, Switch } from "solid-js"
import type { FileContent } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchDiagnostic, WorkbenchGitStatus } from "../lib/store"
import {
  isWorkbenchImageContent,
  workbenchBufferDirty,
  workbenchPathKey,
  type WorkbenchFileBuffer,
} from "../lib/workbench"
import { compactPath } from "../lib/format"
import { LazyCodeEditor } from "./lazy-code-editor"
import { Icon } from "./icon"
import { Button, IconButton } from "./ui"
import { WorkbenchDiagnosticsBar } from "./workbench-diagnostics"

export function WorkbenchEditorPanel(props: {
  buffers: Accessor<WorkbenchFileBuffer<FileContent>[]>
  activePath: Accessor<string>
  openPath: Accessor<string>
  dirty: Accessor<boolean>
  activeBuffer: Accessor<WorkbenchFileBuffer<FileContent> | undefined>
  fileContent: Accessor<FileContent | undefined>
  activeDiagnostics: Accessor<WorkbenchDiagnostic[]>
  diagnostics: Accessor<WorkbenchDiagnostic[]>
  diagnosticsLoading: Accessor<boolean>
  diagnosticsMessage: Accessor<string>
  diagnosticsCommand: Accessor<string>
  runDiagnostics: () => void
  gitStatusByPath: Accessor<Map<string, WorkbenchGitStatus["files"][number]>>
  setActivePath: Setter<string>
  revealFile: (path: string) => void
  closeBuffer: (buffer: WorkbenchFileBuffer<FileContent>) => void
  revertFile: () => void
  saveFile: () => void
  sendContext: (kind: "file" | "selection") => void
  askAboutEdits: () => void
  saveArtifact: (kind: "file" | "selection") => void
  saveEditsArtifact: () => void
  renameFile: () => void
  deleteFile: () => void
  assistantOpen: Accessor<boolean>
  setAssistantOpen: Setter<boolean>
  openDiagnostic: (path: string) => void
  fixDiagnostic: (diagnostic: WorkbenchDiagnostic) => void
  changeBuffer: (path: string, value: string) => void
  saveActiveFile: () => void
  setEditorSelection: Setter<string>
  gitStatusSymbol: (file: WorkbenchGitStatus["files"][number]) => string
}) {
  return (
    <section class="workbench-editor">
      <Show when={props.buffers().length}>
        <div class="workbench-editor-tabs" role="tablist" aria-label="Open files">
          <For each={props.buffers()}>
            {(buffer) => (
              <div class="workbench-editor-tab" classList={{ active: props.activePath() === buffer.path, modified: workbenchBufferDirty(buffer) }}>
                <Button appearance="ghost"
                  type="button"
                  role="tab"
                  aria-selected={props.activePath() === buffer.path}
                  onClick={() => {
                    props.setActivePath(buffer.path)
                    props.revealFile(buffer.path)
                  }}
                >
                  <Icon name={isWorkbenchImageContent(buffer.fileContent) ? "panel" : "file"} />
                  <span>{compactPath(buffer.path)}</span>
                  <Show when={props.gitStatusByPath().get(workbenchPathKey(buffer.path))}>
                    {(file) => <span class={`workbench-tab-status ${file().status}`} title={file().staged ? "Staged" : file().untracked ? "New file" : "Modified"}>{props.gitStatusSymbol(file())}</span>}
                  </Show>
                  <Show when={workbenchBufferDirty(buffer)}><span class="workbench-tab-dot" /></Show>
                </Button>
                <IconButton class="workbench-tab-close" icon="x" label={`Close ${buffer.path}`} onClick={() => props.closeBuffer(buffer)} />
              </div>
            )}
          </For>
        </div>
      </Show>
      <header>
        <div>
          <strong>{props.openPath() ? compactPath(props.openPath()) : "No file open"}</strong>
          <Show when={props.dirty()}><span>modified</span></Show>
        </div>
        <div class="row-actions">
          <Button appearance="ghost" type="button" aria-label="Revert file" title="Revert file" disabled={!props.activeBuffer() || !props.dirty()} onClick={props.revertFile}><Icon name="undo" /></Button>
          <Button appearance="ghost" type="button" aria-label="Save file" title="Save file" disabled={!props.openPath() || !props.dirty()} onClick={props.saveFile}><Icon name="save" /></Button>
          <details class="workbench-menu">
            <summary aria-label="More file actions"><Icon name="more" /></summary>
            <div class="workbench-menu-popover">
              <Button appearance="ghost" type="button" disabled={!props.openPath()} onClick={() => props.sendContext("file")}><Icon name="send" /> Send file</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath()} onClick={() => props.sendContext("selection")}><Icon name="send" /> Send selection</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath() || !props.dirty()} onClick={props.askAboutEdits}><Icon name="send" /> Ask about edits</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath()} onClick={() => props.saveArtifact("file")}><Icon name="panel" /> Save file artifact</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath()} onClick={() => props.saveArtifact("selection")}><Icon name="panel" /> Save selection</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath() || !props.dirty()} onClick={props.saveEditsArtifact}><Icon name="panel" /> Save edit artifact</Button>
              <Button appearance="ghost" type="button" disabled={!props.openPath()} onClick={props.renameFile}><Icon name="pencil" /> Rename</Button>
              <Button appearance="ghost" tone="danger" type="button" disabled={!props.openPath()} onClick={props.deleteFile}><Icon name="trash" /> Delete</Button>
            </div>
          </details>
          <Button appearance="ghost"
            type="button"
            aria-label={props.assistantOpen() ? "Close assistant" : "Open assistant"}
            title={props.assistantOpen() ? "Close assistant" : "Open assistant"}
            aria-pressed={props.assistantOpen()}
            onClick={() => props.setAssistantOpen((open) => !open)}
          ><Icon name="session" /></Button>
        </div>
      </header>
      <WorkbenchDiagnosticsBar
        loading={props.diagnosticsLoading()}
        message={props.diagnosticsMessage()}
        command={props.diagnosticsCommand()}
        diagnostics={props.activeDiagnostics().length > 0 ? props.activeDiagnostics() : props.diagnostics()}
        total={props.diagnostics().length}
        onRun={props.runDiagnostics}
        onOpen={props.openDiagnostic}
        onFix={props.fixDiagnostic}
      />
      <Switch>
        <Match when={isWorkbenchImageContent(props.fileContent())}>
          <div class="workbench-image-preview">
            <img src={`data:${props.fileContent()?.mimeType ?? "image/png"};base64,${props.fileContent()?.content ?? ""}`} alt={props.openPath()} />
          </div>
        </Match>
        <Match when={props.fileContent()?.type === "binary"}>
          <div class="workbench-placeholder">
            <Icon name="file" />
            <strong>Binary file</strong>
            <span>Binary preview is intentionally read-only in this Workbench slice.</span>
          </div>
        </Match>
        <Match when={props.activeBuffer()?.fileContent?.type === "text" ? props.activeBuffer() : undefined}>
          {(buffer) => (
            <LazyCodeEditor
              path={buffer().path}
              value={buffer().content}
              original={buffer().original}
              onChange={(value) => props.changeBuffer(buffer().path, value)}
              onSave={props.saveActiveFile}
              onSelectionChange={props.setEditorSelection}
              diagnostics={props.activeDiagnostics()}
            />
          )}
        </Match>
        <Match when={true}>
          <div class="workbench-placeholder">
            <Icon name="folder-open" />
            <strong>Choose a file</strong>
            <span>Open a text file to edit it, or create a new one in the current folder.</span>
          </div>
        </Match>
      </Switch>
    </section>
  )
}
