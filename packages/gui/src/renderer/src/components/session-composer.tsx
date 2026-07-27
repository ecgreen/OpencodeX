import { TextArea, Button } from "./ui"
import type { JSX } from "solid-js"
import { For, Show, createEffect, createSignal, createUniqueId } from "solid-js"
import type { PromptPart } from "../lib/store"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { PromptMentionOption } from "../lib/prompt-autocomplete"
import { partIcon, partLabel, partPreviewURL, partTitle, promptWithoutPart } from "../lib/composer-parts"
import { Icon } from "./icon"

export function SessionComposer(props: {
  blocked: boolean
  /** Set when the selected model's provider has no credentials on the server. */
  disconnectedProviderName?: string
  connectProvider?: () => void
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
  abortConfirmArmed: boolean
  stashCount: number
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
  stashPrompt: () => void
  popStash: () => void
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
  const [selectedMention, setSelectedMention] = createSignal(0)
  const [mentionDismissed, setMentionDismissed] = createSignal(false)
  const menuID = createUniqueId()
  const mentionMenuVisible = () => props.mentionMenuVisible && !mentionDismissed()
  const selectMention = (offset: number) => {
    const count = props.mentionOptions.length
    if (count > 0) setSelectedMention((current) => (current + offset + count) % count)
  }
  const chooseMode = (mode: "build" | "plan" | "goal") => {
    props.setMode(mode)
    setAddMenuOpen(false)
  }
  createEffect(() => {
    if (!props.mentionMenuVisible) {
      setMentionDismissed(false)
      setSelectedMention(0)
      return
    }
    if (selectedMention() >= props.mentionOptions.length) setSelectedMention(Math.max(0, props.mentionOptions.length - 1))
  })
  return (
    <form class="composer" onSubmit={props.submit} onDragOver={handleComposerDragOver} onDrop={props.dropContext}>
      <Show when={props.disconnectedProviderName}>
        {(name) => (
          <div class="composer-provider-warning" role="status">
            <Icon name="warning" />
            <span><strong>{name()}</strong> is not connected. Add credentials to send with this model, or pick another one.</span>
            <Show when={props.connectProvider}>
              {(connect) => <Button appearance="outline" type="button" onClick={() => connect()()}>Connect</Button>}
            </Show>
          </div>
        )}
      </Show>
      <div class={`composer-input ${props.mode}`}>
        <Show when={props.slashMenuVisible}>
          <div id={`${menuID}-slash`} class="slash-command-menu" role="listbox" aria-label="Session slash commands" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.visibleSlashCommands} fallback={<p>No matching commands.</p>}>
              {(command, index) => (
                 <Button appearance="ghost"
                   id={`${menuID}-slash-${index()}`}
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
        <Show when={mentionMenuVisible()}>
          <div id={`${menuID}-mention`} class="slash-command-menu mention-menu" role="listbox" aria-label="Mentions" onMouseDown={(event) => event.preventDefault()}>
            <For each={props.mentionOptions}>
              {(option, index) => (
                <Button appearance="ghost" id={`${menuID}-mention-${index()}`} type="button" role="option" aria-selected={selectedMention() === index()} classList={{ selected: selectedMention() === index() }} onMouseEnter={() => setSelectedMention(index())} onClick={() => props.chooseMention(option)}>
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
            setSelectedMention(0)
            setMentionDismissed(false)
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (files.length === 0) return
            event.preventDefault()
            props.pasteFiles(files)
          }}
          onKeyDown={(event) => handleComposerKeyDown(event, props, { visible: mentionMenuVisible(), selected: selectedMention(), select: selectMention, dismiss: () => setMentionDismissed(true) })}
          aria-controls={props.slashMenuVisible ? `${menuID}-slash` : mentionMenuVisible() ? `${menuID}-mention` : undefined}
          aria-activedescendant={props.slashMenuVisible ? `${menuID}-slash-${props.selectedSlashCommand}` : mentionMenuVisible() ? `${menuID}-mention-${selectedMention()}` : undefined}
          placeholder={props.blocked ? "Reply to the request above to continue..." : "Message OpencodeX..."}
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
                  <Button appearance="ghost" type="button" role="menuitem" disabled={!props.draftText && props.draftParts.length === 0} onClick={() => { props.stashPrompt(); setAddMenuOpen(false) }}>Stash draft <kbd>Ctrl+Shift+S</kbd></Button>
                  <Button appearance="ghost" type="button" role="menuitem" disabled={props.stashCount === 0} onClick={() => { props.popStash(); setAddMenuOpen(false) }}>Restore stashed draft <kbd>Ctrl+Shift+Y</kbd></Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "goal"} classList={{ selected: props.mode === "goal" }} onClick={() => chooseMode("goal")}>Goal mode</Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "build"} classList={{ selected: props.mode === "build" }} onClick={() => chooseMode("build")}>Build mode</Button>
                  <Button appearance="ghost" type="button" role="menuitemradio" aria-checked={props.mode === "plan"} classList={{ selected: props.mode === "plan" }} onClick={() => chooseMode("plan")}>Plan mode</Button>
                </div>
              </Show>
            </div>
            <Show when={props.stashCount > 0}>
              <Button appearance="ghost" class="composer-stash-chip" type="button" title="Restore stashed draft (Ctrl+Shift+Y)" onClick={props.popStash}>Stashed {props.stashCount}</Button>
            </Show>
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
          <Button appearance="ghost" class="send-button" type="submit" title={props.disconnectedProviderName ? `Connect ${props.disconnectedProviderName} to send` : "Send message"} aria-label="Send message" disabled={props.blocked || Boolean(props.disconnectedProviderName) || (props.draftText.length === 0 && props.draftParts.length === 0)}>
            <Icon name="arrowUp" />
          </Button>
        </div>
      </div>
      <div class="composer-running" aria-live="polite">
        <span class="composer-running-left">
          <Show when={props.running} fallback={<span class="composer-running-placeholder" aria-hidden="true" />}>
            <span class="composer-spinner" aria-label="running" />
            <span class="composer-interrupt" classList={{ armed: props.abortConfirmArmed }} aria-label={props.abortConfirmArmed ? "Press escape again to interrupt the model" : "Press escape to arm interruption"}>
              <span class="composer-interrupt-key">esc</span>{" "}
              <span class="composer-interrupt-action">{props.abortConfirmArmed ? "again to interrupt" : "to interrupt"}</span>
            </span>
          </Show>
        </span>
        <span class="composer-running-right">
          <Show when={props.usageLabel}>
            {(usage) => <span class="composer-token-usage">{usage()}</span>}
          </Show>
          <span class="composer-command-hint"><span>ctrl+k</span> commands</span>
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
  props.setDraftPrompt(promptWithoutPart(props.draftPrompt, part))
}

function handleComposerKeyDown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }, props: Parameters<typeof SessionComposer>[0], mention: { visible: boolean; selected: number; select: (offset: number) => void; dismiss: () => void }) {
  if (mention.visible) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      mention.dismiss()
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      mention.select(event.key === "ArrowUp" ? -1 : 1)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const option = props.mentionOptions[mention.selected]
      if (option) props.chooseMention(option)
      return
    }
  }
  if (props.slashMenuVisible) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
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
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
    event.preventDefault()
    if (props.draftText || props.draftParts.length > 0) props.stashPrompt()
    return
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "y") {
    event.preventDefault()
    if (props.stashCount > 0) props.popStash()
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
