import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { GuiTranscriptExportOptions } from "../lib/transcript-export"
import { ClaudeInstallPanel } from "./claude-install-panel"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { Button, Checkbox, CommandRow, IconButton, Select, TextArea, TextField, TextInput } from "./ui"

export type ChoiceOption = { value: string; title: string; description?: string; meta?: string }
export type ProjectDialogValue = { name: string; folders: string[] }
export type TerminalSessionDialogValue = { title?: string; projectID?: string; directory: string }

export type DialogState =
  | { type: "text"; title: string; message?: string; value?: string; multiline?: boolean; resolve: (value: string | undefined) => void }
  | { type: "confirm"; title: string; message: string; confirm?: string; scope?: string; resolve: (value: boolean) => void }
  | { type: "choice"; title: string; message?: string; options: ChoiceOption[]; resolve: (value: string | undefined) => void }
  | { type: "export"; title: string; message?: string; defaults: GuiTranscriptExportOptions; resolve: (value: GuiTranscriptExportOptions | undefined) => void }
  | { type: "project"; title: string; message?: string; name: string; folders: string[]; resolve: (value: ProjectDialogValue | undefined) => void }
  | {
      type: "terminal-session"
      title: string
      message?: string
      name?: string
      directory: string
      projectID?: string
      projects: ChoiceOption[]
      cliVersion?: string
      resolve: (value: TerminalSessionDialogValue | undefined) => void
    }
  | { type: "claude-install"; title: string; message?: string; resolve: (installed: boolean) => void }

export function DialogModal(props: { dialog?: DialogState; close: () => void }) {
  const [value, setValue] = createSignal("")
  const [folders, setFolders] = createSignal<string[]>([])
  const [manualFolder, setManualFolder] = createSignal("")
  const [terminalDirectory, setTerminalDirectory] = createSignal("")
  const [terminalProjectID, setTerminalProjectID] = createSignal("")
  const [thinking, setThinking] = createSignal(true)
  const [toolDetails, setToolDetails] = createSignal(true)
  const [assistantMetadata, setAssistantMetadata] = createSignal(true)
  const [openWithoutSaving, setOpenWithoutSaving] = createSignal(false)
  const mount = createMemo(() => {
    const scope = props.dialog?.type === "confirm" ? props.dialog.scope : undefined
    if (!scope || typeof document === "undefined") return
    return Array.from(document.querySelectorAll<HTMLElement>(".session-page")).find((element) => element.dataset.sessionId === scope)
  })
  const choiceOptions = createMemo(() => {
    const current = props.dialog
    if (current?.type !== "choice") return []
    const needle = value().trim().toLowerCase()
    if (!needle) return current.options
    return current.options.filter((option) => [option.title, option.description, option.meta, option.value].filter(Boolean).join(" ").toLowerCase().includes(needle))
  })
  createEffect(() => {
    const current = props.dialog
    if (current?.type === "text") {
      setValue(current.value ?? "")
      return
    }
    if (current?.type === "export") {
      setValue(current.defaults.filename)
      setThinking(current.defaults.thinking)
      setToolDetails(current.defaults.toolDetails)
      setAssistantMetadata(current.defaults.assistantMetadata)
      setOpenWithoutSaving(current.defaults.openWithoutSaving)
      return
    }
    if (current?.type === "project") {
      setValue(current.name)
      setFolders(uniqueFolders(current.folders))
      setManualFolder("")
      return
    }
    if (current?.type === "terminal-session") {
      setValue(current.name ?? "")
      setTerminalDirectory(current.directory)
      setTerminalProjectID(current.projectID ?? "")
      return
    }
    setValue("")
    setFolders([])
    setManualFolder("")
  })
  function cancel() {
    const current = props.dialog
    props.close()
    if (!current) return
    if (current.type === "confirm" || current.type === "claude-install") current.resolve(false)
    else current.resolve(undefined)
  }
  function finishInstall(installed: boolean) {
    const current = props.dialog
    props.close()
    if (current?.type === "claude-install") current.resolve(installed)
  }
  function projectValue() {
    const name = value().trim()
    const currentFolders = uniqueFolders(folders())
    return name && currentFolders.length > 0 ? { name, folders: currentFolders } : undefined
  }
  function terminalSessionValue() {
    const directory = terminalDirectory().trim()
    if (!directory) return undefined
    return {
      ...(value().trim() ? { title: value().trim() } : {}),
      ...(terminalProjectID() ? { projectID: terminalProjectID() } : {}),
      directory,
    }
  }
  async function addSelectedFolders() {
    const current = props.dialog
    if (current?.type !== "project") return
    const selected = await window.opencodex?.folders?.(folders()[0] ?? undefined)
      ?? await window.opencodex?.folder(folders()[0] ?? undefined).then((folder) => folder ? [folder] : undefined)
    if (!selected?.length) return
    setFolders((currentFolders) => uniqueFolders([...currentFolders, ...selected]))
  }
  async function chooseTerminalDirectory() {
    const directory = await window.opencodex?.folder(terminalDirectory() || undefined)
    if (directory) setTerminalDirectory(directory)
  }
  function addManualFolder() {
    const next = manualFolder().trim()
    if (!next) return
    setFolders((currentFolders) => uniqueFolders([...currentFolders, next]))
    setManualFolder("")
  }
  function removeFolder(folder: string) {
    setFolders((currentFolders) => currentFolders.filter((item) => item !== folder))
  }
  function choose(value: string) {
    const current = props.dialog
    props.close()
    if (current?.type === "choice") current.resolve(value)
  }
  function submit(event: SubmitEvent) {
    event.preventDefault()
    const current = props.dialog
    // The install panel owns its own actions; a stray Enter must not close it.
    if (!current || current.type === "claude-install") return
    const choice = current.type === "choice" ? choiceOptions()[0]?.value : undefined
    props.close()
    if (current.type === "text") current.resolve(value())
    else if (current.type === "confirm") current.resolve(true)
    else if (current.type === "project") current.resolve(projectValue())
    else if (current.type === "terminal-session") current.resolve(terminalSessionValue())
    else if (current.type === "export") current.resolve({
      filename: value(),
      thinking: thinking(),
      toolDetails: toolDetails(),
      assistantMetadata: assistantMetadata(),
      openWithoutSaving: openWithoutSaving(),
    })
    else current.resolve(choice)
  }
  return (
    <Show when={props.dialog}>
      {(current) => (
        <ModalFrame
          title={current().title}
          description={current().message}
          class={current().type === "project" ? "dialog-card project-editor-modal" : current().type === "terminal-session" ? "dialog-card terminal-session-modal" : current().type === "claude-install" ? "dialog-card claude-install-modal" : current().type === "text" ? `dialog-card text-dialog-card${current().title === "Edit Session" ? " session-edit-modal" : ""}` : "dialog-card"}
          close={cancel}
          mount={mount()}
          backdropClass={mount() ? "dialog-backdrop session-dialog-backdrop" : undefined}
          showClose={current().type !== "confirm"}
          onSubmit={submit}
          footer={current().type === "claude-install" ? undefined : (
            <div class="dialog-actions">
              <Button onClick={cancel}>Cancel</Button>
              <Button type="submit" appearance="solid" tone="accent" disabled={(current().type === "project" && !projectValue()) || (current().type === "terminal-session" && !terminalSessionValue())}>{current().type === "confirm" ? (current() as Extract<DialogState, { type: "confirm" }>).confirm ?? "Confirm" : current().type === "choice" ? "Select" : current().type === "export" ? "Export" : current().type === "terminal-session" ? "Create" : "Save"}</Button>
            </div>
          )}
        >
          <>
            <Show when={current().type === "text"}>
              <Show when={(current() as Extract<DialogState, { type: "text" }>).multiline} fallback={<TextInput value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />}>
                <TextArea value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
              </Show>
            </Show>
            <Show when={current().type === "choice"}>
              <TextInput value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="Search options" autofocus />
              <div class="choice-list">
                <For each={choiceOptions()} fallback={<p>No matching options.</p>}>
                  {(option) => (
                    <CommandRow onClick={() => choose(option.value)}>
                      <strong>{option.title}</strong>
                      <Show when={option.meta}><small>{option.meta}</small></Show>
                      <Show when={option.description}><span>{option.description}</span></Show>
                    </CommandRow>
                  )}
                </For>
              </div>
            </Show>
            <Show when={current().type === "export"}>
              <div class="export-options">
                <label>
                  <span>Filename</span>
                  <TextInput value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="session.md" autofocus />
                </label>
                <Checkbox class="checkbox-row" label="Include thinking" checked={thinking()} onChange={setThinking} />
                <Checkbox class="checkbox-row" label="Include tool details" checked={toolDetails()} onChange={setToolDetails} />
                <Checkbox class="checkbox-row" label="Include assistant metadata" checked={assistantMetadata()} onChange={setAssistantMetadata} />
                <Checkbox class="checkbox-row" label="Open without saving" checked={openWithoutSaving()} onChange={setOpenWithoutSaving} />
              </div>
            </Show>
            <Show when={current().type === "project"}>
              <div class="project-editor-form">
                <label>
                  <span>Project name</span>
                  <TextInput value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="Project name" autofocus />
                </label>
                <section class="project-editor-folders">
                  <header>
                    <div>
                      <strong>Folders</strong>
                      <span>{folders().length} selected</span>
                    </div>
                    <Button icon="folder-open" onClick={() => void addSelectedFolders()}>Add folder</Button>
                  </header>
                  <div class="project-editor-folder-list">
                    <For each={folders()} fallback={<div class="project-editor-empty">No folders selected.</div>}>
                      {(folder) => (
                        <div class="project-editor-folder-row">
                          <span title={folder}>{folder}</span>
                          <IconButton icon="x" label={`Remove ${folder}`} onClick={() => removeFolder(folder)} />
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="project-editor-manual">
                    <TextInput value={manualFolder()} onInput={(event) => setManualFolder(event.currentTarget.value)} placeholder="Paste a folder path" />
                    <Button onClick={addManualFolder} disabled={!manualFolder().trim()}>Add path</Button>
                  </div>
                </section>
                <Show when={!projectValue()}>
                  <p class="project-editor-error">Project name and at least one folder are required.</p>
                </Show>
              </div>
            </Show>
            <Show when={current().type === "terminal-session"}>
              <div class="terminal-session-form">
                <TextField
                  label="Display name"
                  description="Optional label shown in OpencodeX."
                  value={value()}
                  placeholder="Claude Code"
                  onInput={(event) => setValue(event.currentTarget.value)}
                  autofocus
                />
                <TextField
                  label="Working directory"
                  description="Claude runs and resumes from this folder. Fixed after creation."
                  required
                  technical
                  value={terminalDirectory()}
                  onInput={(event) => setTerminalDirectory(event.currentTarget.value)}
                  error={terminalDirectory().trim() ? undefined : "Choose a working directory."}
                  suffix={<IconButton appearance="ghost" size="compact" icon="folder-open" label="Browse for folder" onClick={() => void chooseTerminalDirectory()} />}
                />
                <Select<ChoiceOption>
                  label="Project"
                  description="Optional grouping in OpencodeX."
                  options={[
                    { value: "", title: "No project", description: "Keep this session in the global catalog" },
                    ...(current() as Extract<DialogState, { type: "terminal-session" }>).projects,
                  ]}
                  current={[
                    { value: "", title: "No project", description: "Keep this session in the global catalog" },
                    ...(current() as Extract<DialogState, { type: "terminal-session" }>).projects,
                  ].find((option) => option.value === terminalProjectID())}
                  optionValue={(option) => option.value}
                  optionLabel={(option) => option.title}
                  onSelect={(option) => setTerminalProjectID(option?.value ?? "")}
                />
                <Show when={(current() as Extract<DialogState, { type: "terminal-session" }>).cliVersion}>
                  {(cliVersion) => (
                    <div class="terminal-session-cli" role="status">
                      <Icon name="check" />
                      <span>Claude Code {cliVersion()} detected</span>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
            <Show when={current().type === "claude-install"}>
              <ClaudeInstallPanel finish={finishInstall} />
            </Show>
          </>
        </ModalFrame>
      )}
    </Show>
  )
}

function uniqueFolders(folders: string[]) {
  return [...new Set(folders.map((folder) => folder.trim()).filter(Boolean))]
}
