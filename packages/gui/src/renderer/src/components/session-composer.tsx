import type { JSX } from "solid-js"
import { For, Show } from "solid-js"
import type { PromptPart } from "../lib/store"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { PromptMentionOption } from "../lib/prompt-autocomplete"
import { prunePromptPartsForInput } from "../lib/prompt-autocomplete"
import { Icon } from "./icon"

export function SessionComposer(props: {
  blocked: boolean
  running: boolean
  mode: "plan" | "build"
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
  cycleVariant: () => void
  loadHistory: (offset: number) => boolean
  toggleMode: () => void
  selectVariant: (variant: string) => void
}) {
  return (
    <form class="composer" onSubmit={props.submit}>
      <div class={`composer-input ${props.mode}`}>
        <Show when={props.slashMenuVisible}>
          <div class="slash-command-menu" role="listbox" aria-label="Session slash commands" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.visibleSlashCommands} fallback={<p>No matching commands.</p>}>
              {(command, index) => (
                <button
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
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.mentionMenuVisible}>
          <div class="slash-command-menu mention-menu" role="listbox" aria-label="Mentions" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.mentionOptions}>
              {(option) => (
                <button type="button" role="option" onClick={() => props.chooseMention(option)}>
                  <strong>{option.replacement}</strong>
                  <span>{option.category} - {option.detail}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <textarea
          ref={props.setTextarea}
          disabled={props.blocked}
          value={props.draftPrompt}
          onFocus={() => props.setSlashMenuOpen(true)}
          onBlur={() => props.setSlashMenuOpen(false)}
          onInput={(event) => {
            const value = event.currentTarget.value
            props.setDraftPrompt(value)
            props.setDraftParts((current) => prunePromptPartsForInput(value, current))
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
        <div class="composer-footer">
          <div class="composer-meta" aria-live="polite">
            <button class={`mode-chip ${props.mode}`} type="button" disabled={props.blocked} onClick={props.toggleMode} title="Toggle Build/Plan mode">
              {props.mode === "plan" ? "Plan" : "Build"}
            </button>
            <button class="model-menu" type="button" disabled={props.blocked} onClick={() => props.setModelPickerOpen(true)} title="Choose model">{props.modelLabel}</button>
            <Show when={props.variants.length > 0}>
              <div
                class="variant-menu-wrap"
                onFocusOut={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.setVariantPickerOpen(false)
                }}
              >
                <button
                  class="variant-trigger"
                  type="button"
                  disabled={props.blocked}
                  aria-haspopup="listbox"
                  aria-expanded={props.variantPickerOpen}
                  title="Change variant (Ctrl+T to cycle)"
                  onClick={() => props.setVariantPickerOpen((open) => !open)}
                >
                  {props.variantLabel}
                </button>
                <Show when={props.variantPickerOpen}>
                  <div class="variant-menu" role="listbox" aria-label="Choose variant">
                    <button type="button" role="option" aria-selected={props.selectedVariant === ""} classList={{ selected: props.selectedVariant === "" }} onClick={() => props.selectVariant("")}>Default</button>
                    <For each={props.variants}>
                      {(variant) => (
                        <button type="button" role="option" aria-selected={props.selectedVariant === variant} classList={{ selected: props.selectedVariant === variant }} onClick={() => props.selectVariant(variant)}>
                          {variant}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <Show when={props.draftParts.length > 0}>
            <div class="composer-stash-actions">
              <span>{props.draftParts.length} attachment{props.draftParts.length === 1 ? "" : "s"}</span>
            </div>
          </Show>
          <button class="send-button" type="submit" title="Send message" aria-label="Send message" disabled={props.blocked || props.draftText.length === 0}>
            <Icon name="arrowUp" />
          </button>
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
