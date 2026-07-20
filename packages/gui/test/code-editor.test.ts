import { describe, expect, test } from "bun:test"
import { EditorState } from "@codemirror/state"
import { diagnosticRanges, editorOffset } from "../src/renderer/src/components/code-editor-extensions"
import { codeEditorFindAction } from "../src/renderer/src/components/code-editor-find-keys"
import { codeEditorHoverText } from "../src/renderer/src/components/code-editor-hover"

describe("code editor locations", () => {
  test("converts one-based LSP ranges into CodeMirror diagnostics", () => {
    const state = EditorState.create({ doc: "one\nabcdef\nthree" })
    expect(diagnosticRanges(state, [
      { line: 2, column: 2, endLine: 2, endColumn: 5, severity: "warning", message: "Check value" },
      { line: 20, column: 1, severity: "error", message: "Outside document" },
    ])).toEqual([{
      from: 5,
      to: 8,
      severity: "warning",
      message: "Check value",
    }])
  })

  test("clamps definition positions to valid lines and columns", () => {
    const state = EditorState.create({ doc: "one\nabc" })
    expect(editorOffset(state, 2, 2)).toBe(5)
    expect(editorOffset(state, 99, 99)).toBe(7)
    expect(editorOffset(state, 0, 0)).toBe(0)
  })

  test("maps finder keyboard controls without exposing replace modes", () => {
    expect(codeEditorFindAction("Enter", false)).toBe("next")
    expect(codeEditorFindAction("Enter", true)).toBe("previous")
    expect(codeEditorFindAction("Escape", false)).toBe("close")
    expect(codeEditorFindAction("r", false)).toBeUndefined()
  })

  test("renders LSP markdown as safe readable tooltip text", () => {
    expect(codeEditorHoverText("```ts\nconst helper: () => string\n```\n**Returns** a [value](https://example.com)."))
      .toBe("const helper: () => string\nReturns a value.")
  })
})
