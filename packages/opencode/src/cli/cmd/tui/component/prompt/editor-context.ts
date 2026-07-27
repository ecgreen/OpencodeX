import path from "path"
import { createMemo, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { editorSelectionKey, useEditorContext } from "@tui/context/editor"
import { useKV } from "../../context/kv"
import { Locale } from "@/util/locale"
import { getEditorRangeLabel, hasEditorRangeSelection } from "./helpers"

export function createPromptEditorContext() {
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const [dismissedSelectionKey, setDismissedSelectionKey] = createSignal<string>()
  const context = createMemo(() => {
    const selection = kv.get("file_context_enabled", true) ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedSelectionKey() ? undefined : selection
  })
  const selectionLabel = createMemo(() => {
    const ranges = context()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined].filter(Boolean).join(" ")
  })
  const fileLabel = createMemo(() => {
    const value = context()?.filePath
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${selectionLabel() ?? ""}`
  })
  const displayLabel = createMemo(() => {
    const file = fileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })

  function dismiss() {
    setDismissedSelectionKey(editorSelectionKey(context()))
    editor.clearSelection()
  }

  return { editor, context, labelState: () => editor.labelState(), displayLabel, dismiss }
}
