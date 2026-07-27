import { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, on } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useEvent } from "@tui/context/event"
import { createStore, produce, unwrap } from "solid-js/store"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptDrafts } from "./drafts"
import { computePromptTraits } from "./traits"
import type { AutocompleteRef } from "./autocomplete"
import { useRenderer } from "@opentui/solid"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { TuiEvent } from "../../event"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "../../context/kv"
import { DRAFT_RETENTION_MIN_CHARS, promptHistoryEntry, randomIndex } from "./helpers"
import type { PromptProps, PromptRef, PromptState } from "./types"
import { createPromptEditorContext } from "./editor-context"
import { createPromptOpencodeXContext } from "./opencodex"
import { createPromptSessionContext } from "./session-context"
import { createPromptWorkspaceController } from "./workspace"
import { restorePromptExtmarks, syncPromptExtmarks } from "./extmarks"
import { createPromptPasteController } from "./paste"
import { createPromptSubmit } from "./submit"
import { PromptView } from "./view"
import { installPromptCommands } from "./commands"
import { installPromptInputBindings } from "./bindings"

export type { PromptProps, PromptRef } from "./types"

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  const [inputTarget, setInputTarget] = createSignal<TextareaRenderable | undefined>()

  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const status = createMemo(() => {
    const sessionID = props.sessionID ?? ""
    const current = sync.data.session_status?.[sessionID]
    if (sync.data.session_pending_prompt?.[sessionID] && (!current || current.type === "idle"))
      return { type: "busy" } as const
    return current ?? ({ type: "idle" } as const)
  })
  const history = usePromptHistory()
  const drafts = usePromptDrafts()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const editorState = createPromptEditorContext()
  const workspace = createPromptWorkspaceController({ sessionID: () => props.sessionID })
  const opencodex = createPromptOpencodeXContext({
    sessionID: () => props.sessionID,
    targetLabel: () => props.targetLabel,
  })
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const [cursorVersion, setCursorVersion] = createSignal(0)
  const draftKey = createMemo(() => props.draftKey ?? props.sessionID ?? "home")

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const session = createPromptSessionContext({
    sessionID: () => props.sessionID,
    useSessionContext: () => props.useSessionContext,
    swarmID: opencodex.swarmID,
  })

  const [store, setStore] = createStore<PromptState>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })
  const paste = createPromptPasteController({
    textarea: () => input,
    renderer,
    state: store,
    setStore,
    pasteStyleID: pasteStyleId,
    promptPartTypeID: () => promptPartTypeId,
    summarize: () => kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary),
  })
  const submit = createPromptSubmit({
    props,
    textarea: () => input,
    state: store,
    setStore,
    autoVisible: () => !!auto()?.visible,
    promptPartTypeID: () => promptPartTypeId,
    syncExtmarks: syncExtmarksWithPromptParts,
    clear: clearPrompt,
    draftKey,
    editor: editorState,
    opencodex,
    session,
    workspace,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )
  installPromptCommands({
    props,
    state: store,
    setStore,
    textarea: () => input,
    autoVisible: () => !!auto()?.visible,
    status,
    submit,
    clear: clearPrompt,
    paste,
    restoreExtmarks: restoreExtmarksFromParts,
    editor: editorState,
    opencodex,
    workspace,
  })
  installPromptInputBindings({
    props,
    state: store,
    setStore,
    textarea: () => input,
    target: inputTarget,
    cursorVersion,
    autoVisible: () => !!auto()?.visible,
    shellPlaceholders: shell,
    draftKey,
    applyPrompt,
    restoreExtmarks: restoreExtmarksFromParts,
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      applyPrompt(prompt)
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("mode", "normal")
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
    cycleAgent(direction) {
      if (props.sessionID && props.useSessionContext) {
        local.agent.moveSession(props.sessionID, direction, session.agent()?.name)
        return
      }
      local.agent.move(direction)
    },
    cycleVariant() {
      if (props.sessionID && props.useSessionContext) {
        const model = session.model()
        if (!model) return
        local.model.variant.cycleForSession(props.sessionID, model, session.variant())
        return
      }
      local.model.variant.cycle()
    },
  }

  function applyPrompt(prompt: PromptInfo) {
    input.setText(prompt.input)
    setStore("prompt", prompt)
    setStore("mode", prompt.mode ?? "normal")
    restoreExtmarksFromParts(prompt.parts)
    input.gotoBufferEnd()
  }

  let activeDraftKey: string | undefined
  createEffect(
    on(
      () => [draftKey(), drafts.ready] as const,
      ([key, ready]) => {
        if (!ready) return
        if (activeDraftKey === undefined) {
          // First mount: seed from drafts if present, otherwise stay empty.
          activeDraftKey = key
          if (store.prompt.input) return
          const saved = drafts.get(key)
          if (!saved) return
          applyPrompt(saved)
          return
        }
        if (key === activeDraftKey) return

        // Persist the prompt we are leaving under the key we are leaving.
        const leaving = { ...unwrap(store.prompt), mode: store.mode }
        if (leaving.input.length === 0 && leaving.parts.length === 0) {
          drafts.clear(activeDraftKey)
        } else {
          drafts.set(activeDraftKey, leaving)
        }

        activeDraftKey = key

        // Seed the new key's draft into the input.
        const saved = drafts.get(key)
        if (saved) {
          applyPrompt(saved)
        } else {
          input.clear()
          input.extmarks.clear()
          setStore("prompt", { input: "", parts: [] })
          setStore("mode", "normal")
          setStore("extmarkToPartIndex", new Map())
        }
      },
    ),
  )

  // Persist on every prompt change after the initial mount.
  createEffect(
    on(
      () => [store.prompt, store.mode] as const,
      ([current, mode]) => {
        if (!drafts.ready) return
        const key = activeDraftKey
        if (!key) return
        if (current.input.length === 0 && current.parts.length === 0) {
          drafts.clear(key)
          return
        }
        drafts.set(key, {
          ...current,
          mode,
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const key = props.sessionID
    if (!key) return
    const entries = (sync.data.message[key] ?? [])
      .filter((message): message is UserMessage => message.role === "user")
      .map((message) => promptHistoryEntry(sync.data.part[message.id] ?? []))
      .filter((entry): entry is PromptInfo => entry !== undefined)
    history.seed(key, entries)
  })

  onCleanup(() => {
    void drafts.flushNow()
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = {
      ...input.traits,
      ...computePromptTraits({
        mode: store.mode,
        autocompleteVisible: !!auto()?.visible,
      }),
    }
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    restorePromptExtmarks({
      textarea: input,
      parts,
      typeID: promptPartTypeId,
      fileStyleID: fileStyleId,
      agentStyleID: agentStyleId,
      pasteStyleID: pasteStyleId,
      setStore,
    })
  }

  function syncExtmarksWithPromptParts() {
    syncPromptExtmarks({ textarea: input, typeID: promptPartTypeId, setStore })
  }

  function clearPrompt() {
    if (store.prompt.input.trim().length >= DRAFT_RETENTION_MIN_CHARS || store.prompt.parts.length > 0) {
      history.append(draftKey(), {
        ...store.prompt,
        mode: store.mode,
      })
    }
    input.clear()
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
  }

  return (
    <PromptView
      props={props}
      state={store}
      status={status}
      textarea={() => input}
      anchor={() => anchor}
      auto={auto}
      setAuto={(value) => setAuto(() => value)}
      mountTextarea={(value) => {
        input = value
        setInputTarget(value)
        if (promptPartTypeId === 0) promptPartTypeId = value.extmarks.registerType("prompt-part")
        props.ref?.(ref)
      }}
      mountAnchor={(value) => {
        anchor = value
      }}
      ref={ref}
      submit={submit}
      paste={paste.inputText}
      contentChanged={() => {
        const value = input.plainText
        setStore("prompt", "input", value)
        auto()?.onInput(value)
        syncExtmarksWithPromptParts()
        setCursorVersion((version) => version + 1)
      }}
      cursorChanged={() => setCursorVersion((version) => version + 1)}
      setPrompt={(callback) => setStore("prompt", produce(callback))}
      setExtmark={(partIndex, extmarkID) => {
        setStore("extmarkToPartIndex", (map) => new Map(map).set(extmarkID, partIndex))
      }}
      fileStyleID={fileStyleId}
      agentStyleID={agentStyleId}
      promptPartTypeID={() => promptPartTypeId}
      editor={editorState}
      opencodex={opencodex}
      session={session}
      workspace={workspace}
    />
  )
}
