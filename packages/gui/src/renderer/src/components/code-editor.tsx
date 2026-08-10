import { syntaxHighlighting } from "@codemirror/language"
import { startCompletion } from "@codemirror/autocomplete"
import { Compartment, EditorState, Prec } from "@codemirror/state"
import { SearchQuery, findNext, findPrevious, search, setSearchQuery } from "@codemirror/search"
import { EditorView, keymap } from "@codemirror/view"
import { lintGutter } from "@codemirror/lint"
import { basicSetup } from "codemirror"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { WorkbenchDiagnostic } from "../lib/session-api"
import { createCodeEditorCompletionExtension, type CodeEditorCompletionLoad } from "./code-editor-completion"
import { loadCodeEditorLanguage } from "./code-editor-language"
import { CodeEditorFind } from "./code-editor-find"
import { createCodeEditorHoverExtension, type CodeEditorHover } from "./code-editor-hover"
import {
  codeEditorHighlightStyle,
  diagnosticExtensions,
  editorOffset,
  modifiedLineDecorations,
  selectedEditorText,
} from "./code-editor-extensions"

export type CodeEditorNavigation = {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  token: number
}

export type CodeEditorProps = {
  path: string
  value: string
  original: string
  onChange: (value: string) => void
  onSave: () => void
  onSelectionChange?: (value: string) => void
  onDefinition?: (position: { line: number; column: number }) => void
  onHover?: (position: { line: number; column: number }, signal?: AbortSignal) => Promise<CodeEditorHover | undefined>
  onCompletion?: CodeEditorCompletionLoad
  diagnostics?: readonly WorkbenchDiagnostic[]
  navigation?: CodeEditorNavigation
  readOnly?: boolean
}

export function CodeEditor(props: CodeEditorProps) {
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
  let languageLoad = 0
  let requestedLanguagePath = ""
  let findInput: HTMLInputElement | undefined
  let revealedNavigation = 0
  const [finderOpen, setFinderOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [matchCount, setMatchCount] = createSignal(0)
  const language = new Compartment()
  const modified = new Compartment()
  const diagnostics = new Compartment()
  const access = new Compartment()
  const completion = new Compartment()
  const hover = createCodeEditorHoverExtension((position, signal) => props.onHover?.(position, signal))
  const lspCompletion = createCodeEditorCompletionExtension((position, context, signal) => props.onCompletion?.(position, context, signal))

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
          diagnostics.of(diagnosticExtensions(props.path, props.diagnostics ?? [])),
          access.of([EditorState.readOnly.of(props.readOnly === true), EditorView.editable.of(props.readOnly !== true)]),
          completion.of(props.readOnly ? [] : lspCompletion.extension),
          lintGutter(),
          search(),
          syntaxHighlighting(codeEditorHighlightStyle),
          Prec.highest(keymap.of([{
            key: "Mod-s",
            run: () => {
              if (props.readOnly) return true
              props.onSave()
              return true
            },
          }, {
            key: "Ctrl-Space",
            run: (editor) => props.readOnly ? false : startCompletion(editor),
          }, {
            key: "Mod-f",
            run: openFinder,
          }, {
            key: "F3",
            run: nextMatch,
          }, {
            key: "Shift-F3",
            run: previousMatch,
          }, {
            key: "Mod-g",
            run: nextMatch,
          }, {
            key: "Shift-Mod-g",
            run: previousMatch,
          }])),
          EditorView.domEventHandlers({
            click(event, editor) {
              if (event.button !== 0 || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return false
              const offset = editor.posAtCoords({ x: event.clientX, y: event.clientY })
              if (offset === null) return false
              const line = editor.state.doc.lineAt(offset)
              props.onDefinition?.({ line: line.number, column: offset - line.from + 1 })
              event.preventDefault()
              return true
            },
          }),
          hover.extension,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !props.readOnly) props.onChange(update.state.doc.toString())
            if (update.selectionSet || update.docChanged) props.onSelectionChange?.(selectedEditorText(update.state))
            if (update.docChanged && finderOpen()) updateMatchCount()
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
              backgroundColor: "var(--ds-text-selection)",
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
            ".cm-tooltip.cm-tooltip-hover": {
              maxWidth: "min(560px, calc(100vw - 32px))",
              maxHeight: "320px",
              overflow: "auto",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              borderRadius: "7px",
              backgroundColor: "#121417",
              color: "#e5e7eb",
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
            },
            ".code-editor-hover": {
              minWidth: "220px",
              fontFamily: "\"Cascadia Code\", \"JetBrains Mono\", \"SFMono-Regular\", Consolas, monospace",
              fontSize: "12px",
              lineHeight: "1.5",
            },
            ".code-editor-hover-section": {
              margin: "0",
              padding: "8px 10px",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            },
            ".code-editor-hover-section + .code-editor-hover-section": {
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            },
            ".code-editor-hover-code": {
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              color: "#dcdcaa",
            },
            ".code-editor-hover-definition": {
              color: "#9cdcfe",
              fontSize: "11px",
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
    const path = props.path
    void configureLanguage(path)
    closeFinder(false)
  })

  createEffect(() => {
    view?.dispatch({
      effects: [
        modified.reconfigure(modifiedLineDecorations(props.original)),
        diagnostics.reconfigure(diagnosticExtensions(props.path, props.diagnostics ?? [])),
      ],
    })
  })

  createEffect(() => {
    view?.dispatch({
      effects: [
        access.reconfigure([EditorState.readOnly.of(props.readOnly === true), EditorView.editable.of(props.readOnly !== true)]),
        completion.reconfigure(props.readOnly ? [] : lspCompletion.extension),
      ],
    })
  })

  createEffect(() => {
    const navigation = props.navigation
    if (!view || !navigation || navigation.path !== props.path || navigation.token === revealedNavigation) return
    revealedNavigation = navigation.token
    const anchor = editorOffset(view.state, navigation.line, navigation.column)
    const head = editorOffset(view.state, navigation.endLine, navigation.endColumn)
    view.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    })
    view.focus()
  })

  onCleanup(() => {
    languageLoad += 1
    hover.dispose()
    lspCompletion.dispose()
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

  function openFinder() {
    if (!view) return false
    const selection = selectedEditorText(view.state)
    if (selection && !selection.includes("\n")) updateQuery(selection)
    setFinderOpen(true)
    queueMicrotask(() => {
      findInput?.focus()
      findInput?.select()
    })
    return true
  }

  function closeFinder(focus = true) {
    setFinderOpen(false)
    setQuery("")
    setMatchCount(0)
    view?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "", literal: true })) })
    if (focus) view?.focus()
  }

  function updateQuery(value: string) {
    setQuery(value)
    view?.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: value, literal: true })) })
    updateMatchCount()
  }

  function updateMatchCount() {
    if (!view || !query()) {
      setMatchCount(0)
      return
    }
    const cursor = new SearchQuery({ search: query(), literal: true }).getCursor(view.state)
    setMatchCount(Array.from({ [Symbol.iterator]: () => cursor }).length)
  }

  function nextMatch() {
    if (!view) return false
    if (!finderOpen()) return openFinder()
    return findNext(view)
  }

  function previousMatch() {
    if (!view) return false
    if (!finderOpen()) return openFinder()
    return findPrevious(view)
  }

  return (
    <div class="workbench-code-editor">
      <div class="workbench-codemirror" ref={(element) => { host = element }} />
      <Show when={finderOpen()}>
        <CodeEditorFind
          query={query()}
          count={matchCount()}
          setInput={(element) => { findInput = element }}
          setQuery={updateQuery}
          previous={() => { previousMatch() }}
          next={() => { nextMatch() }}
          close={closeFinder}
        />
      </Show>
    </div>
  )
}
