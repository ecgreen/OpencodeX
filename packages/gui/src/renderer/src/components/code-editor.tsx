import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, keymap } from "@codemirror/view"
import { lintGutter, linter, type Diagnostic } from "@codemirror/lint"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { createEffect, onCleanup, onMount } from "solid-js"
import type { WorkbenchDiagnostic } from "../lib/store"
import { workbenchChangedLineNumbers, workbenchLanguageID } from "../lib/workbench"
import { loadCodeEditorLanguage } from "./code-editor-language"

export type CodeEditorProps = {
  path: string
  value: string
  original: string
  onChange: (value: string) => void
  onSave: () => void
  onSelectionChange?: (value: string) => void
  diagnostics?: readonly WorkbenchDiagnostic[]
}

export function CodeEditor(props: CodeEditorProps) {
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
  let languageLoad = 0
  let requestedLanguagePath = ""
  const language = new Compartment()
  const modified = new Compartment()
  const diagnostics = new Compartment()

  onMount(() => {
    if (!host) return
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          language.of([]),
          modified.of(modifiedLineDecorations(props.original)),
          diagnostics.of(diagnosticLineDecorations(props.diagnostics ?? [])),
          lintGutter(),
          linter((view) => syntaxErrorDiagnostics(view, props.path), { delay: 250 }),
          syntaxHighlighting(vsCodeDarkHighlightStyle),
          keymap.of([{
            key: "Mod-s",
            run: () => {
              props.onSave()
              return true
            },
          }]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) props.onChange(update.state.doc.toString())
            if (update.selectionSet || update.docChanged) props.onSelectionChange?.(selectedText(update.state))
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "#1e1e1e",
              color: "#d4d4d4",
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily: "\"Cascadia Code\", \"JetBrains Mono\", \"SFMono-Regular\", Consolas, monospace",
              fontVariantLigatures: "none",
              fontFeatureSettings: "\"liga\" 0, \"calt\" 0",
              lineHeight: "1.55",
            },
            ".cm-content, .cm-line": {
              fontVariantLigatures: "none",
              fontFeatureSettings: "\"liga\" 0, \"calt\" 0",
            },
            ".cm-gutters": {
              backgroundColor: "#1e1e1e",
              borderRight: "1px solid #404040",
              color: "#858585",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "#2a2d2e",
              color: "#c6c6c6",
            },
            ".cm-activeLine": {
              backgroundColor: "#2a2d2e",
            },
            ".cm-cursor": {
              borderLeftColor: "#d4d4d4",
            },
            ".cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection, .cm-line::selection, .cm-line *::selection": {
              backgroundColor: "#264f78",
              color: "inherit",
            },
            ".cm-dropCursor": {
              borderLeftColor: "#007acc",
            },
            ".cm-lineModified": {
              backgroundColor: "rgba(0, 122, 204, .14)",
              boxShadow: "inset 3px 0 #007acc",
            },
            ".cm-lineDiagnosticError": {
              backgroundColor: "rgba(244, 71, 71, .12)",
              boxShadow: "inset 3px 0 #f44747",
            },
            ".cm-lineDiagnosticWarning": {
              backgroundColor: "rgba(206, 145, 120, .12)",
              boxShadow: "inset 3px 0 #ce9178",
            },
            ".cm-lintRange-error": {
              backgroundImage: "linear-gradient(45deg, transparent 65%, #f44747 80%, transparent 90%)",
              backgroundPosition: "left bottom",
              backgroundRepeat: "repeat-x",
              backgroundSize: "6px 3px",
              paddingBottom: "2px",
            },
            ".cm-lintRange-warning": {
              backgroundImage: "linear-gradient(45deg, transparent 65%, #ce9178 80%, transparent 90%)",
              backgroundPosition: "left bottom",
              backgroundRepeat: "repeat-x",
              backgroundSize: "6px 3px",
              paddingBottom: "2px",
            },
            ".cm-lint-marker-error": {
              color: "#f44747",
            },
            ".cm-lint-marker-warning": {
              color: "#ce9178",
            },
            ".cm-tooltip.cm-tooltip-lint": {
              backgroundColor: "#121417",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              borderRadius: "7px",
              color: "#e5e7eb",
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
            },
            ".cm-tooltip-lint .cm-diagnostic": {
              padding: "8px 10px",
              color: "#e5e7eb",
            },
            ".cm-tooltip-lint .cm-diagnostic-error": {
              borderLeft: "3px solid #fb7185",
            },
            "&.cm-focused": {
              outline: "none",
            },
          }),
        ],
      }),
    })
    void configureLanguage(props.path)
  })

  createEffect(() => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === props.value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
    })
  })

  createEffect(() => {
    void configureLanguage(props.path)
  })

  createEffect(() => {
    view?.dispatch({
      effects: [
        modified.reconfigure(modifiedLineDecorations(props.original)),
        diagnostics.reconfigure(diagnosticLineDecorations(props.diagnostics ?? [])),
      ],
    })
  })

  onCleanup(() => {
    languageLoad += 1
    view?.destroy()
  })

  async function configureLanguage(path: string) {
    if (!view) return
    if (path === requestedLanguagePath) return
    requestedLanguagePath = path
    const request = ++languageLoad
    const extension = await loadCodeEditorLanguage(path)
    if (!view || request !== languageLoad) return
    view.dispatch({ effects: language.reconfigure(extension) })
  }

  return <div class="workbench-codemirror" ref={(element) => { host = element }} />
}

const vsCodeDarkHighlightStyle = HighlightStyle.define([
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

function selectedText(state: EditorState) {
  return state.selection.ranges.map((range) => state.sliceDoc(range.from, range.to)).join("\n")
}

function modifiedLineDecorations(original: string): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const changed = workbenchChangedLineNumbers({ original, current: state.doc.toString() })
    const decorations = Array.from(changed).flatMap((lineNumber) =>
      lineNumber > state.doc.lines ? [] : [Decoration.line({ class: "cm-lineModified" }).range(state.doc.line(lineNumber).from)],
    )
    return Decoration.set(decorations)
  })
}

function diagnosticLineDecorations(diagnostics: readonly WorkbenchDiagnostic[]): Extension {
  return EditorView.decorations.compute(["doc"], (state) =>
    Decoration.set(diagnostics.flatMap((item) => {
      if (!item.line || item.line > state.doc.lines) return []
      return [
        Decoration.line({
          class: item.severity === "warning" ? "cm-lineDiagnosticWarning" : "cm-lineDiagnosticError",
        }).range(state.doc.line(item.line).from),
      ]
    })),
  )
}

function syntaxErrorDiagnostics(view: EditorView, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!node.type.isError) return
      if (syntaxErrorInsideComment(view.state, path, node.from)) return
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
