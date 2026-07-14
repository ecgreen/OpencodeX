import type { Accessor } from "solid-js"
import { createMemo } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import type { SetStoreFunction } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { useBindings } from "../../keymap"
import { useTuiConfig } from "../../context/tui-config"
import { DialogStash } from "../dialog-stash"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { randomIndex } from "./helpers"
import type { PromptProps, PromptState } from "./types"

export function installPromptInputBindings(input: {
  props: PromptProps
  state: PromptState
  setStore: SetStoreFunction<PromptState>
  textarea: () => TextareaRenderable
  target: Accessor<TextareaRenderable | undefined>
  cursorVersion: Accessor<number>
  autoVisible: () => boolean
  shellPlaceholders: () => string[]
  draftKey: () => string
  applyPrompt: (prompt: PromptInfo) => void
  restoreExtmarks: (parts: PromptInfo["parts"]) => void
}) {
  const dialog = useDialog()
  const history = usePromptHistory()
  const stash = usePromptStash()
  const tuiConfig = useTuiConfig()
  const stashCommands = createMemo(() => [
    {
      title: "Stash prompt",
      name: "prompt.stash",
      category: "Prompt",
      enabled: !!input.state.prompt.input,
      run: () => {
        if (!input.state.prompt.input) return
        stash.push({ input: input.state.prompt.input, parts: input.state.prompt.parts })
        input.textarea().extmarks.clear()
        input.textarea().clear()
        input.setStore("prompt", { input: "", parts: [] })
        input.setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      name: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      run: () => {
        const entry = stash.pop()
        if (entry) applyEntry(entry)
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      name: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      run: () => dialog.replace(() => <DialogStash onSelect={applyEntry} />),
    },
  ].map((command) => ({ namespace: "palette", ...command })))

  useBindings(() => ({ commands: stashCommands() }))
  useBindings(() => ({
    target: input.target,
    enabled: input.target() !== undefined && !input.props.disabled,
    bindings: tuiConfig.keybinds.get("prompt.paste"),
  }))
  useBindings(() => ({
    target: input.target,
    enabled: input.target() !== undefined && !input.props.disabled && input.state.prompt.input !== "",
    bindings: tuiConfig.keybinds.get("prompt.clear"),
  }))
  useBindings(() => ({
    target: input.target,
    enabled: shellModeAvailable(),
    bindings: [{
      key: "!",
      desc: "Shell mode",
      group: "Prompt",
      cmd: () => {
        input.setStore("placeholder", randomIndex(input.shellPlaceholders().length))
        input.setStore("mode", "shell")
      },
    }],
  }))
  useBindings(() => ({
    target: input.target,
    enabled: input.target() !== undefined && input.state.mode === "shell",
    bindings: [{ key: "escape", desc: "Exit shell mode", group: "Prompt", cmd: () => input.setStore("mode", "normal") }],
  }))
  useBindings(() => ({
    target: input.target,
    enabled: shellBackspaceAvailable(),
    bindings: [{ key: "backspace", desc: "Exit shell mode", group: "Prompt", cmd: () => input.setStore("mode", "normal") }],
  }))
  useBindings(() => ({
    target: input.target,
    enabled: historyAvailable(),
    commands: [{
      name: "prompt.history.previous",
      title: "Previous prompt history",
      category: "Prompt",
      run: previousHistory,
    }],
    bindings: tuiConfig.keybinds.get("prompt.history.previous"),
  }))
  useBindings(() => ({
    target: input.target,
    enabled: historyAvailable(),
    commands: [{
      name: "prompt.history.next",
      title: "Next prompt history",
      category: "Prompt",
      run: nextHistory,
    }],
    bindings: tuiConfig.keybinds.get("prompt.history.next"),
  }))

  function applyEntry(entry: PromptInfo) {
    input.textarea().setText(entry.input)
    input.setStore("prompt", { input: entry.input, parts: entry.parts })
    input.restoreExtmarks(entry.parts)
    input.textarea().gotoBufferEnd()
  }

  function shellModeAvailable() {
    input.cursorVersion()
    return input.target() !== undefined
      && !input.props.disabled
      && input.state.mode === "normal"
      && !input.autoVisible()
      && input.textarea().visualCursor.offset === 0
  }

  function shellBackspaceAvailable() {
    input.cursorVersion()
    return input.target() !== undefined && input.state.mode === "shell" && input.textarea().visualCursor.offset === 0
  }

  function historyAvailable() {
    input.cursorVersion()
    return input.target() !== undefined && !input.props.disabled && !input.autoVisible()
  }

  function previousHistory() {
    if (input.textarea().cursorOffset !== 0) {
      if (input.textarea().scrollY + input.textarea().visualCursor.visualRow === 0) input.textarea().cursorOffset = 0
      return false
    }
    const item = history.move(input.draftKey(), -1, input.textarea().plainText)
    if (!item) return false
    input.applyPrompt(item)
    input.textarea().cursorOffset = 0
  }

  function nextHistory() {
    if (input.textarea().cursorOffset !== input.textarea().plainText.length) {
      if (input.textarea().scrollY + input.textarea().visualCursor.visualRow === Math.max(0, input.textarea().editorView.getTotalVirtualLineCount() - 1)) {
        input.textarea().cursorOffset = input.textarea().plainText.length
      }
      return false
    }
    const item = history.move(input.draftKey(), 1, input.textarea().plainText)
    if (!item) return false
    input.applyPrompt(item)
    input.textarea().cursorOffset = input.textarea().plainText.length
  }
}
