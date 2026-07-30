import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete"
import type { Extension } from "@codemirror/state"
import type { WorkbenchCompletionItem, WorkbenchCompletionResult } from "../lib/session-api"

export type CodeEditorCompletionLoad = (
  position: { line: number; column: number },
  context: { triggerKind: 1 | 2 | 3; triggerCharacter?: string },
  signal?: AbortSignal,
) => Promise<WorkbenchCompletionResult | undefined> | undefined

export function createCodeEditorCompletionExtension(load: CodeEditorCompletionLoad) {
  const source = createCodeEditorCompletionSource(load)
  return {
    extension: autocompletion({ override: [source.load], activateOnTyping: true }) as Extension,
    dispose: source.dispose,
  }
}

export function createCodeEditorCompletionSource(load: CodeEditorCompletionLoad) {
  let controller: AbortController | undefined
  const source: CompletionSource = async (context) => {
    const word = context.matchBefore(/[\w$]*/) ?? { from: context.pos, to: context.pos, text: "" }
    const triggered = context.state.sliceDoc(Math.max(0, word.from - 1), word.from) === "."
    if (!context.explicit && !triggered) return null
    controller?.abort()
    const pending = new AbortController()
    controller = pending
    context.addEventListener("abort", () => pending.abort(), { onDocChange: true })
    const line = context.state.doc.lineAt(context.pos)
    try {
      const result = await load(
        { line: line.number, column: context.pos - line.from + 1 },
        triggered ? { triggerKind: 2, triggerCharacter: "." } : { triggerKind: 1 },
        pending.signal,
      )
      if (pending.signal.aborted || context.aborted || !result?.supported || result.items.length === 0) return null
      return completionResult(word.from, result.items)
    } catch {
      return null
    }
  }
  return { load: source, dispose: () => controller?.abort() }
}

export function completionResult(from: number, items: readonly WorkbenchCompletionItem[]): CompletionResult {
  return {
    from,
    options: [...items]
      .sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label))
      .map(codeEditorCompletion),
    validFor: /^[\w$]*$/,
  }
}

function codeEditorCompletion(item: WorkbenchCompletionItem): Completion {
  const completion: Completion = {
    label: item.filterText ?? item.label,
    displayLabel: item.label,
    detail: item.detail,
    info: item.documentation,
    type: completionType(item.kind),
    apply: item.insertText ?? item.label,
  }
  if (item.insertTextFormat !== 2 || !item.insertText) return completion
  return snippetCompletion(lspSnippet(item.insertText), completion)
}

function lspSnippet(value: string) {
  return value
    .replace(/\$\{0(?::[^}]*)?\}|\$0/g, "")
    .replace(/\$\{(\d+):([^}]*)\}/g, (_match, _index, name: string) => `\${${name || "value"}}`)
    .replace(/\$\{(\d+)\}/g, (_match, index: string) => `\${arg${index}}`)
    .replace(/\$(\d+)/g, (_match, index: string) => `\${arg${index}}`)
}

function completionType(kind?: number): Completion["type"] {
  if (kind === 2 || kind === 3) return "method"
  if (kind === 4) return "function"
  if (kind === 5 || kind === 10) return "property"
  if (kind === 6) return "variable"
  if (kind === 7) return "class"
  if (kind === 8) return "interface"
  if (kind === 9) return "namespace"
  if (kind === 13 || kind === 20 || kind === 21) return "constant"
  if (kind === 14) return "keyword"
  if (kind === 15 || kind === 17) return "text"
  return undefined
}
