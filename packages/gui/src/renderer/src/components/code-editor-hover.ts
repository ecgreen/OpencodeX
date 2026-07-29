import { hoverTooltip } from "@codemirror/view"
import type { WorkbenchHoverResult } from "../lib/session-api"
import { editorOffset } from "./code-editor-extensions"

export type CodeEditorHover = WorkbenchHoverResult

export function createCodeEditorHoverExtension(
  load: (position: { line: number; column: number }, signal?: AbortSignal) => Promise<CodeEditorHover | undefined> | undefined,
) {
  let controller: AbortController | undefined
  return {
    extension: hoverTooltip(async (editor, offset) => {
      const character = editor.state.sliceDoc(offset, offset + 1) || editor.state.sliceDoc(Math.max(0, offset - 1), offset)
      if (!character || /^\s$/.test(character)) return null
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const line = editor.state.doc.lineAt(offset)
      const hover = await Promise.resolve(load({ line: line.number, column: offset - line.from + 1 }, pending.signal)).catch(() => undefined)
      if (pending.signal.aborted || !hover?.supported || (hover.contents.length === 0 && hover.definitions.length === 0)) return null
      const word = editor.state.wordAt(offset)
      const from = hover.range ? editorOffset(editor.state, hover.range.line, hover.range.column) : word?.from ?? offset
      const to = hover.range ? editorOffset(editor.state, hover.range.endLine, hover.range.endColumn) : word?.to ?? offset
      return {
        pos: from,
        end: Math.max(from + 1, to),
        above: true,
        create: () => ({ dom: codeEditorHoverElement(hover) }),
      }
    }, { hoverTime: 350, hideOnChange: true }),
    dispose: () => controller?.abort(),
  }
}

function codeEditorHoverElement(hover: CodeEditorHover) {
  const dom = document.createElement("div")
  dom.className = "code-editor-hover"
  hover.contents.forEach((content) => {
    const section = document.createElement(content.kind === "code" ? "pre" : "div")
    section.className = `code-editor-hover-section${content.kind === "code" ? " code-editor-hover-code" : ""}`
    section.textContent = content.kind === "markdown" ? codeEditorHoverText(content.value) : content.value
    dom.appendChild(section)
  })
  const definition = hover.definitions[0]
  if (definition) {
    const section = document.createElement("div")
    section.className = "code-editor-hover-section code-editor-hover-definition"
    section.textContent = `Defined in ${definition.path}:${definition.line}:${definition.column}`
    dom.appendChild(section)
  }
  return dom
}

export function codeEditorHoverText(value: string) {
  return value
    .replace(/```(?:[\w-]+)?\r?\n([\s\S]*?)\r?\n```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
}
