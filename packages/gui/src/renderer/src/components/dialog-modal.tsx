import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { GuiTranscriptExportOptions } from "../lib/transcript-export"

export type ChoiceOption = { value: string; title: string; description?: string; meta?: string }

export type DialogState =
  | { type: "text"; title: string; message?: string; value?: string; multiline?: boolean; resolve: (value: string | undefined) => void }
  | { type: "confirm"; title: string; message: string; confirm?: string; resolve: (value: boolean) => void }
  | { type: "choice"; title: string; message?: string; options: ChoiceOption[]; resolve: (value: string | undefined) => void }
  | { type: "export"; title: string; message?: string; defaults: GuiTranscriptExportOptions; resolve: (value: GuiTranscriptExportOptions | undefined) => void }

export function DialogModal(props: { dialog?: DialogState; close: () => void }) {
  const [value, setValue] = createSignal("")
  const [thinking, setThinking] = createSignal(true)
  const [toolDetails, setToolDetails] = createSignal(true)
  const [assistantMetadata, setAssistantMetadata] = createSignal(true)
  const [openWithoutSaving, setOpenWithoutSaving] = createSignal(false)
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
    setValue("")
  })
  function cancel() {
    const current = props.dialog
    props.close()
    if (!current) return
    if (current.type === "confirm") current.resolve(false)
    else current.resolve(undefined)
  }
  function choose(value: string) {
    const current = props.dialog
    props.close()
    if (current?.type === "choice") current.resolve(value)
  }
  function submit(event: SubmitEvent) {
    event.preventDefault()
    const current = props.dialog
    const choice = current?.type === "choice" ? choiceOptions()[0]?.value : undefined
    props.close()
    if (!current) return
    if (current.type === "text") current.resolve(value())
    else if (current.type === "confirm") current.resolve(true)
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
        <div
          class="dialog-backdrop"
          onMouseDown={cancel}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }}
        >
          <form class="dialog-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{current().title}</h2>
            <Show when={current().message}>
              <p>{current().message}</p>
            </Show>
            <Show when={current().type === "text"}>
              <Show when={(current() as Extract<DialogState, { type: "text" }>).multiline} fallback={<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />}>
                <textarea value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
              </Show>
            </Show>
            <Show when={current().type === "choice"}>
              <input value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="Search options" autofocus />
              <div class="choice-list">
                <For each={choiceOptions()} fallback={<p>No matching options.</p>}>
                  {(option) => (
                    <button type="button" onClick={() => choose(option.value)}>
                      <strong>{option.title}</strong>
                      <Show when={option.meta}><small>{option.meta}</small></Show>
                      <Show when={option.description}><span>{option.description}</span></Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={current().type === "export"}>
              <div class="export-options">
                <label>
                  <span>Filename</span>
                  <input value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="session.md" autofocus />
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" checked={thinking()} onChange={(event) => setThinking(event.currentTarget.checked)} />
                  <span>Include thinking</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" checked={toolDetails()} onChange={(event) => setToolDetails(event.currentTarget.checked)} />
                  <span>Include tool details</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" checked={assistantMetadata()} onChange={(event) => setAssistantMetadata(event.currentTarget.checked)} />
                  <span>Include assistant metadata</span>
                </label>
                <label class="checkbox-row">
                  <input type="checkbox" checked={openWithoutSaving()} onChange={(event) => setOpenWithoutSaving(event.currentTarget.checked)} />
                  <span>Open without saving</span>
                </label>
              </div>
            </Show>
            <div class="dialog-actions">
              <button type="button" class="secondary" onClick={cancel}>Cancel</button>
              <button type="submit" class="primary">{current().type === "confirm" ? (current() as Extract<DialogState, { type: "confirm" }>).confirm ?? "Confirm" : current().type === "choice" ? "Select" : current().type === "export" ? "Export" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </Show>
  )
}
