import { HighlightStyle, syntaxTree } from "@codemirror/language"
import { type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"
import { linter, type Diagnostic } from "@codemirror/lint"
import { tags } from "@lezer/highlight"
import type { WorkbenchDiagnostic } from "../lib/store"
import { workbenchChangedLineNumbers, workbenchLanguageID } from "../lib/workbench"

export const codeEditorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#6a9955" },
  { tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
  { tag: [tags.number, tags.bool, tags.null], color: "#b5cea8" },
  { tag: [tags.keyword, tags.operatorKeyword], color: "#569cd6" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "#c586c0" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: "#dcdcaa" },
  { tag: [tags.variableName, tags.propertyName], color: "#9cdcfe" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#4ec9b0" },
  { tag: [tags.attributeName, tags.labelName], color: "#9cdcfe" },
  { tag: tags.regexp, color: "#d16969" },
  { tag: tags.escape, color: "#d7ba7d" },
  { tag: tags.heading, color: "#569cd6", fontWeight: "600" },
  { tag: tags.link, color: "#569cd6", textDecoration: "underline" },
  { tag: tags.invalid, color: "#f44747" },
])

export function selectedEditorText(state: EditorState) {
  return state.selection.ranges.map((range) => state.sliceDoc(range.from, range.to)).join("\n")
}

export function modifiedLineDecorations(original: string): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const changed = workbenchChangedLineNumbers({ original, current: state.doc.toString() })
    return Decoration.set(Array.from(changed).flatMap((lineNumber) =>
      lineNumber > state.doc.lines ? [] : [Decoration.line({ class: "cm-lineModified" }).range(state.doc.line(lineNumber).from)],
    ))
  })
}

export function diagnosticExtensions(path: string, diagnostics: readonly WorkbenchDiagnostic[]): Extension {
  return [
    EditorView.decorations.compute(["doc"], (state) => Decoration.set(diagnostics.flatMap((item) => {
      if (!item.line || item.line > state.doc.lines) return []
      const level = item.severity === "warning" ? "Warning" : item.severity === "info" ? "Info" : "Error"
      return [Decoration.line({ class: `cm-lineDiagnostic${level}` }).range(state.doc.line(item.line).from)]
    }))),
    linter((view) => [...syntaxErrorDiagnostics(view, path), ...diagnosticRanges(view.state, diagnostics)], { delay: 250 }),
  ]
}

export function diagnosticRanges(state: EditorState, diagnostics: readonly WorkbenchDiagnostic[]): Diagnostic[] {
  return diagnostics.flatMap((item) => {
    if (!item.line || item.line > state.doc.lines) return []
    const from = editorOffset(state, item.line, item.column ?? 1)
    return [{
      from,
      to: Math.max(from, editorOffset(state, item.endLine ?? item.line, item.endColumn ?? (item.column ?? 1) + 1)),
      severity: item.severity,
      message: item.message,
    }]
  })
}

export function editorOffset(state: EditorState, lineNumber: number, column: number) {
  const line = state.doc.line(Math.min(Math.max(1, lineNumber), state.doc.lines))
  return Math.min(line.to, line.from + Math.max(0, column - 1))
}

function syntaxErrorDiagnostics(view: EditorView, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!node.type.isError || syntaxErrorInsideComment(view.state, path, node.from)) return
      diagnostics.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        severity: "error",
        message: "Syntax error. Check for a missing delimiter, quote, or closing bracket near this line.",
      })
    },
  })
  return diagnostics.slice(0, 100)
}

function syntaxErrorInsideComment(state: EditorState, path: string, position: number) {
  const line = state.doc.lineAt(position)
  const text = line.text.trimStart()
  const language = workbenchLanguageID(path)
  if (lineCommentPrefixes(language).some((prefix) => text.startsWith(prefix))) return true
  if (!blockCommentLanguages().has(language)) return false
  const before = state.sliceDoc(0, position)
  return before.lastIndexOf("/*") > before.lastIndexOf("*/")
}

function lineCommentPrefixes(language: string) {
  if (["javascript", "rust", "go", "c", "cpp", "java", "csharp", "kotlin", "scala", "dart"].includes(language)) return ["//"]
  if (["python", "shell", "powershell", "ruby", "yaml", "toml", "properties"].includes(language)) return ["#"]
  if (language === "sql") return ["--"]
  if (language === "html") return ["<!--"]
  return []
}

function blockCommentLanguages() {
  return new Set(["javascript", "css", "rust", "go", "c", "cpp", "java", "csharp", "kotlin", "scala", "dart", "sql"])
}
