import { TextArea, Button } from "./ui"
import type { JSX } from "solid-js"
import { For, Show, createSignal } from "solid-js"
import type { PromptPart } from "../lib/store"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { PromptMentionOption } from "../lib/prompt-autocomplete"
import { Icon } from "./icon"

export function SessionComposer(props: {
  blocked: boolean
  running: boolean
  mode: "plan" | "build" | "goal"
  draftPrompt: string
  draftParts: PromptPart[]
  draftText: string
  slashMenuVisible: boolean
  visibleSlashCommands: SessionSlashCommand[]
  selectedSlashCommand: number
  mentionMenuVisible: boolean
  mentionOptions: PromptMentionOption[]
  variants: string[]
  variantPickerOpen: boolean
  selectedVariant: string
  modelLabel: string
  variantLabel: string
  usageLabel: string | undefined
  submit: JSX.EventHandler<HTMLFormElement, SubmitEvent>
  setTextarea: (element: HTMLTextAreaElement) => void
  setDraftPrompt: (value: string) => void
  setDraftParts: (update: (current: PromptPart[]) => PromptPart[]) => void
  setHistoryIndex: (value: number) => void
  setHistoryDraft: (value: string) => void
  setSlashMenuOpen: (value: boolean) => void
  setSelectedSlashCommand: (value: number) => void
  setModelPickerOpen: (value: boolean) => void
  setVariantPickerOpen: (value: boolean | ((open: boolean) => boolean)) => void
  runSlashCommand: (command: SessionSlashCommand | undefined) => void
  completeSlashCommand: (command: SessionSlashCommand | undefined) => void
  selectSlashCommand: (offset: number) => void
  chooseMention: (option: PromptMentionOption) => void
  pasteFiles: (files: File[]) => void
  addPickedContext: () => void
  dropContext: (event: DragEvent) => void
  cycleVariant: () => void
  loadHistory: (offset: number) => boolean
  toggleMode: () => void
  setMode: (mode: "build" | "plan" | "goal") => void
  selectVariant: (variant: string) => void
}) {
  const [addMenuOpen, setAddMenuOpen] = createSignal(false)
  const chooseMode = (mode: "build" | "plan" | "goal") => {
    props.setMode(mode)
    setAddMenuOpen(false)
  }
  return (
    <form class="composer" onSubmit={props.submit} onDragOver={handleComposerDragOver} onDrop={props.dropContext}>
      <div class={`composer-input ${props.mode}`}>
        <Show when={props.slashMenuVisible}>
          <div class="slash-command-menu" role="listbox" aria-label="Session slash commands" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.visibleSlashCommands} fallback={<p>No matching commands.</p>}>
              {(command, index) => (
                <Button appearance="ghost"
                  type="button"
                  role="option"
                  aria-selected={props.selectedSlashCommand === index()}
                  disabled={!!command.disabled}
                  classList={{ selected: props.selectedSlashCommand === index() }}
                  title={command.disabled}
                  onMouseEnter={() => props.setSelectedSlashCommand(index())}
                  onClick={() => props.runSlashCommand(command)}
                >
                  <strong>/{command.name}</strong>
                  <span>{command.title} - {command.disabled ?? command.detail}</span>
                </Button>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.mentionMenuVisible}>
          <div class="slash-command-menu mention-menu" role="listbox" aria-label="Mentions" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.mentionOptions}>
              {(option) => (
                <Button appearance="ghost" type="button" role="option" onClick={() => props.chooseMention(option)}>
                  <strong>{option.replacement}</strong>
                  <span>{option.category} - {option.detail}</span>
                </Button>
              )}
            </For>
          </div>
        </Show>
        <TextArea
          ref={props.setTextarea}
          disabled={props.blocked}
          value={props.draftPrompt}
          onFocus={() => props.setSlashMenuOpen(true)}
          onBlur={() => props.setSlashMenuOpen(false)}
          onInput={(event) => {
            const value = event.currentTarget.value
            props.setDraftPrompt(value)
            props.setHistoryIndex(-1)
            props.setHistoryDraft("")
            props.setSlashMenuOpen(true)
            props.setSelectedSlashCommand(0)
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (files.length === 0) return
            event.preventDefault()
            props.pasteFiles(files)
          }}
          onKeyDown={(event) => handleComposerKeyDown(event, props)}
          placeholder={props.blocked ? "Reply to the pending permission/question before continuing..." : "Message OpencodeX..."}
        />
        <Show when={props.draftParts.length > 0}>
          <div class="composer-context-preview" aria-label="Attached context">
            <For each={props.draftParts}>
              {(part) => (
                <Button appearance="ghost" type="button" title={partTitle(part)} onClick={() => removePart(part, props)}>
                  <Show when={partPreviewURL(part)} fallback={<Icon name={partIcon(part)} />}>
                    {(src) => <img class="composer-context-preview-image" src={src()} alt="" />}
                  </Show>
                  <span>{partLabel(part)}</span>
                  <Icon name="x" />
                </Button>
              )}
            </For>
          </div>
        </Show>
        <div class="composer-footer">
          <div class="composer-meta" aria-live="polite">
            <div
              class="composer-add-menu-wrap"
              onFocusOut={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAddMenuOpen(false)
              }}
            >
              <Button appearance="ghost"
                class="composer-add-context"
                type="button"
                disabled={props.blocked}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen()}
                onClick={() => setAddMenuOpen((open) => !open)}
                title="Add context or change mode"
                aria-label="Add context or change mode"
              >
                <Icon name="plus" />
              </Button>
              <Show when={addMenuOpen()}>
                <div class="composer-add-menu" role="menu" aria-label="Add context or change mode">
                  <Button appearance="ghost" type="button" role="menuitem" onClick={() => { props.addPickedContext(); setAddMenuOpen(false) }}>File & Folder context</Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "goal"} classList={{ selected: props.mode === "goal" }} onClick={() => chooseMode("goal")}>Goal mode</Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "build"} classList={{ selected: props.mode === "build" }} onClick={() => chooseMode("build")}>Build mode</Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "plan"} classList={{ selected: props.mode === "plan" }} onClick={() => chooseMode("plan")}>Plan mode</Button>
                </div>
              </Show>
            </div>
            <Button appearance="ghost" class={`mode-chip ${props.mode}`} type="button" disabled={props.blocked} onClick={props.toggleMode} title="Cycle mode">
              {props.mode === "plan" ? "Plan" : props.mode === "goal" ? "Goal" : "Build"}
            </Button>
            <Button appearance="ghost" class="model-menu" type="button" disabled={props.blocked} onClick={() => props.setModelPickerOpen(true)} title="Choose model">{props.modelLabel}</Button>
            <Show when={props.variants.length > 0}>
              <div
                class="variant-menu-wrap"
                onFocusOut={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.setVariantPickerOpen(false)
                }}
              >
                <Button appearance="ghost"
                  class="variant-trigger"
                  type="button"
                  disabled={props.blocked}
                  aria-haspopup="listbox"
                  aria-expanded={props.variantPickerOpen}
                  title="Change variant (Ctrl+T to cycle)"
                  onClick={() => props.setVariantPickerOpen((open) => !open)}
                >
                  {props.variantLabel}
                </Button>
                <Show when={props.variantPickerOpen}>
                  <div class="variant-menu" role="listbox" aria-label="Choose variant">
                    <Button appearance="ghost" type="button" role="option" aria-selected={props.selectedVariant === ""} classList={{ selected: props.selectedVariant === "" }} onClick={() => props.selectVariant("")}>Default</Button>
                    <For each={props.variants}>
                      {(variant) => (
                        <Button appearance="ghost" type="button" role="option" aria-selected={props.selectedVariant === variant} classList={{ selected: props.selectedVariant === variant }} onClick={() => props.selectVariant(variant)}>
                          {variant}
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <Button appearance="ghost" class="send-button" type="submit" title="Send message" aria-label="Send message" disabled={props.blocked || (props.draftText.length === 0 && props.draftParts.length === 0)}>
            <Icon name="arrowUp" />
          </Button>
        </div>
      </div>
      <div class="composer-running" aria-live="polite">
        <span class="composer-running-left">
          <Show when={props.running} fallback={<span class="composer-running-placeholder" aria-hidden="true" />}>
            <span class="composer-spinner" aria-label="running" />
            <span class="composer-interrupt" aria-label="Press escape to interrupt the model">
              <span class="composer-interrupt-key">esc</span>{" "}
              <span class="composer-interrupt-action">interrupt</span>
            </span>
          </Show>
        </span>
        <span class="composer-running-right">
          <Show when={props.usageLabel}>
            {(usage) => <span class="composer-token-usage">{usage()}</span>}
          </Show>
          <span class="composer-command-hint"><span>ctrl+p</span> commands</span>
        </span>
      </div>
    </form>
  )
}

function handleComposerDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return
  event.preventDefault()
  event.dataTransfer.dropEffect = "copy"
}

function removePart(part: PromptPart, props: Parameters<typeof SessionComposer>[0]) {
  props.setDraftParts((current) => current.filter((item) => item !== part))
  props.setDraftPrompt(partRemovalLabels(part).reduce((input, label) => input.replace(`@${label}`, ""), props.draftPrompt).replace(/\n{3,}/g, "\n\n").trim())
}

function partLabel(part: PromptPart) {
  if (part.type === "agent") return part.name
  if (part.type === "file") {
    if (part.filename) return fileBasename(part.filename)
    if (part.source?.type === "file") return fileBasename(part.source.path)
    if (part.source?.type === "resource") return fileBasename(part.source.uri)
    return "File"
  }
  return part.text.slice(0, 48) || "Text"
}

function partIcon(part: PromptPart) {
  return part.type === "file" && part.mime === "application/x-directory" ? "folder" : "file"
}

function partPreviewURL(part: PromptPart) {
  if (part.type !== "file" || !part.mime.startsWith("image/")) return
  return part.url
}

function partTitle(part: PromptPart) {
  if (part.type !== "file") return partLabel(part)
  return part.source?.type === "file" ? part.source.path : part.source?.type === "resource" ? part.source.uri : part.filename ?? "File"
}

function partRemovalLabels(part: PromptPart) {
  if (part.type === "agent") return [part.name]
  if (part.type !== "file") return []
  return [
    part.filename,
    part.filename ? fileBasename(part.filename) : undefined,
    part.source?.type === "file" ? part.source.path : undefined,
    part.source?.type === "file" ? fileBasename(part.source.path) : undefined,
    part.source?.type === "resource" ? part.source.uri : undefined,
    part.source?.type === "resource" ? fileBasename(part.source.uri) : undefined,
  ].filter((item, index, labels): item is string => Boolean(item) && labels.indexOf(item) === index)
}

function fileBasename(value: string) {
  return value.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).at(-1) ?? value
}

function handleComposerKeyDown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }, props: Parameters<typeof SessionComposer>[0]) {
  if (props.slashMenuVisible) {
    if (event.key === "Escape") {
      event.preventDefault()
      props.setSlashMenuOpen(false)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      props.selectSlashCommand(-1)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      props.selectSlashCommand(1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      props.runSlashCommand(props.visibleSlashCommands[props.selectedSlashCommand])
      return
    }
    if (event.key === "Tab") {
      event.preventDefault()
      props.completeSlashCommand(props.visibleSlashCommands[props.selectedSlashCommand])
      return
    }
  }
  if (event.ctrlKey && event.key.toLowerCase() === "t") {
    event.preventDefault()
    if (!props.blocked) props.cycleVariant()
    return
  }
  if (event.altKey && event.key === "ArrowUp") {
    event.preventDefault()
    props.loadHistory(-1)
    return
  }
  if (event.altKey && event.key === "ArrowDown") {
    event.preventDefault()
    props.loadHistory(1)
    return
  }
  const historyOffset = promptHistoryOffset(event)
  if (historyOffset !== undefined && props.loadHistory(historyOffset)) {
    event.preventDefault()
    return
  }
  if (event.key === "Tab") {
    event.preventDefault()
    if (!props.blocked) props.toggleMode()
    return
  }
  if (event.key !== "Enter" || event.shiftKey) return
  event.preventDefault()
  event.currentTarget.form?.requestSubmit()
}

function promptHistoryOffset(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const textarea = event.currentTarget
  if (event.key === "ArrowUp" && textarea.value.slice(0, textarea.selectionStart).includes("\n") === false) return -1
  if (event.key !== "ArrowDown") return
  if (textarea.value.slice(textarea.selectionEnd).includes("\n")) return
  return 1
}
