import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { yaml } from "@codemirror/lang-yaml"
import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { c, cpp, csharp, dart, java, kotlin, scala } from "@codemirror/legacy-modes/mode/clike"
import { diff } from "@codemirror/legacy-modes/mode/diff"
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile"
import { go } from "@codemirror/legacy-modes/mode/go"
import { lua } from "@codemirror/legacy-modes/mode/lua"
import { powerShell } from "@codemirror/legacy-modes/mode/powershell"
import { properties } from "@codemirror/legacy-modes/mode/properties"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { standardSQL } from "@codemirror/legacy-modes/mode/sql"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, keymap } from "@codemirror/view"
import { lintGutter, linter, type Diagnostic } from "@codemirror/lint"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { createEffect, onCleanup, onMount } from "solid-js"
import type { WorkbenchDiagnostic } from "../lib/store"
import { workbenchChangedLineNumbers, workbenchLanguageID } from "../lib/workbench"

export function CodeEditor(props: {
  path: string
  value: string
  original: string
  onChange: (value: string) => void
  onSave: () => void
  onSelectionChange?: (value: string) => void
  diagnostics?: readonly WorkbenchDiagnostic[]
}) {
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
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
          language.of(languageForPath(props.path)),
          modified.of(modifiedLineDecorations(props.original)),
          diagnostics.of(diagnosticLineDecorations(props.diagnostics ?? [])),
          lintGutter(),
          linter(syntaxErrorDiagnostics, { delay: 250 }),
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
              backgroundColor: "#264f78 !important",
              color: "inherit !important",
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
            "&.cm-focused": {
              outline: "none",
            },
          }),
        ],
      }),
    })
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
    view?.dispatch({
      effects: [
        language.reconfigure(languageForPath(props.path)),
        modified.reconfigure(modifiedLineDecorations(props.original)),
        diagnostics.reconfigure(diagnosticLineDecorations(props.diagnostics ?? [])),
      ],
    })
  })

  onCleanup(() => view?.destroy())

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

function syntaxErrorDiagnostics(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!node.type.isError) return
      diagnostics.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        severity: "error",
        message: "Syntax error",
      })
    },
  })
  return diagnostics.slice(0, 100)
}

function languageForPath(file: string): Extension {
  const language = workbenchLanguageID(file)
  const extension = file.toLowerCase().split(".").at(-1) ?? ""
  if (language === "javascript") return javascript({ jsx: ["jsx", "tsx"].includes(extension), typescript: ["ts", "tsx"].includes(extension) })
  if (language === "css") return css()
  if (language === "html") return html()
  if (language === "json") return json()
  if (language === "markdown") return markdown()
  if (language === "python") return python()
  if (language === "shell") return StreamLanguage.define(shell)
  if (language === "powershell") return StreamLanguage.define(powerShell)
  if (language === "rust") return rust()
  if (language === "yaml") return yaml()
  if (language === "toml") return StreamLanguage.define(toml)
  if (language === "sql") return StreamLanguage.define(standardSQL)
  if (language === "go") return StreamLanguage.define(go)
  if (language === "ruby") return StreamLanguage.define(ruby)
  if (language === "lua") return StreamLanguage.define(lua)
  if (language === "c") return StreamLanguage.define(c)
  if (language === "cpp") return StreamLanguage.define(cpp)
  if (language === "java") return StreamLanguage.define(java)
  if (language === "csharp") return StreamLanguage.define(csharp)
  if (language === "kotlin") return StreamLanguage.define(kotlin)
  if (language === "scala") return StreamLanguage.define(scala)
  if (language === "dart") return StreamLanguage.define(dart)
  if (language === "dockerfile") return StreamLanguage.define(dockerFile)
  if (language === "diff") return StreamLanguage.define(diff)
  if (language === "properties") return StreamLanguage.define(properties)
  return []
}
