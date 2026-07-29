import { describe, expect, test } from "bun:test"
import { CompletionContext } from "@codemirror/autocomplete"
import { EditorState } from "@codemirror/state"
import { completionResult, createCodeEditorCompletionSource } from "../src/renderer/src/components/code-editor-completion"
import type { WorkbenchCompletionResult } from "../src/renderer/src/lib/session-api"

describe("code editor completion", () => {
  test("maps sorted LSP fields and practical snippets", () => {
    const result = completionResult(4, [{
      label: "map",
      filterText: "map-filter",
      sortText: "2",
      detail: "Array method",
      documentation: "Transforms each item",
      insertText: "map(${1:item})$0",
      insertTextFormat: 2,
      kind: 2,
    }, {
      label: "at",
      sortText: "1",
      kind: 5,
    }])

    expect(result.from).toBe(4)
    expect(result.options.map((item) => item.displayLabel ?? item.label)).toEqual(["at", "map"])
    expect(result.options[1]).toMatchObject({ label: "map-filter", displayLabel: "map", detail: "Array method", info: "Transforms each item", type: "method" })
    expect(typeof result.options[1]?.apply).toBe("function")
  })

  test("aborts stale requests and keeps the latest completion", async () => {
    const pending: Array<{ signal?: AbortSignal; resolve: (value: WorkbenchCompletionResult) => void }> = []
    const source = createCodeEditorCompletionSource((_position, _context, signal) => new Promise((resolve) => pending.push({ signal, resolve })))
    const state = EditorState.create({ doc: "value." })
    const first = source.load(new CompletionContext(state, state.doc.length, false))
    await waitFor(() => pending.length === 1)
    const second = source.load(new CompletionContext(state, state.doc.length, false))
    await waitFor(() => pending.length === 2)

    expect(pending[0]?.signal?.aborted).toBe(true)
    pending[1]?.resolve({ supported: true, items: [{ label: "latest" }] })
    pending[0]?.resolve({ supported: true, items: [{ label: "stale" }] })
    expect((await second)?.options[0]?.label).toBe("latest")
    expect(await first).toBeNull()
    source.dispose()
  })
})

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 100 })) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error("Timed out waiting for completion request")
}
