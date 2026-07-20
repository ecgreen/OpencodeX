import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "../../src/lsp/lsp"
import { Filesystem } from "../../src/util/filesystem"
import type { InstanceContext } from "../../src/project/instance-context"
import {
  fileWorkbenchDiagnostics,
  workbenchCompletionResult,
  workbenchDefinitionLocations,
  workbenchHoverResult,
  workbenchRelativeImport,
} from "../../src/opencodex/workbench-diagnostics"
import path from "path"
import { pathToFileURL } from "url"
import { makeOpencodeXWorkbenchFileHandlers } from "../../src/server/routes/instance/httpapi/handlers/opencodex-workbench-file-handlers"
import { TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

describe("OpencodeX workbench file analysis", () => {
  test("converts LSP diagnostic severity and ranges for one file", () => {
    expect(fileWorkbenchDiagnostics("src\\app.ts", [
      {
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 11 } },
        severity: 1,
        message: "Unknown name",
      },
      {
        range: { start: { line: 5, character: 0 }, end: { line: 6, character: 3 } },
        severity: 2,
        message: "Unused import",
      },
      {
        range: { start: { line: 8, character: 1 }, end: { line: 8, character: 2 } },
        severity: 3,
        message: "Hint",
      },
    ])).toEqual([
      { path: "src/app.ts", line: 3, column: 5, endLine: 3, endColumn: 12, severity: "error", message: "Unknown name" },
      { path: "src/app.ts", line: 6, column: 1, endLine: 7, endColumn: 4, severity: "warning", message: "Unused import" },
      { path: "src/app.ts", line: 9, column: 2, endLine: 9, endColumn: 3, severity: "info", message: "Hint" },
    ])
  })

  test("normalizes Location and LocationLink results and filters external targets", () => {
    const directory = path.resolve(".tmp-workbench-definition")
    const source = path.join(directory, "src", "source.ts")
    const linked = path.join(directory, "src", "linked.ts")
    const external = path.resolve(".tmp-workbench-external", "outside.ts")
    const range = { start: { line: 3, character: 6 }, end: { line: 3, character: 12 } }
    const instance: InstanceContext = {
      directory,
      worktree: "/",
      project: {} as InstanceContext["project"],
    }

    expect(workbenchDefinitionLocations([
      { uri: pathToFileURL(source).href, range },
      { uri: pathToFileURL(source).href, range },
      {
        targetUri: pathToFileURL(linked).href,
        targetRange: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
        targetSelectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
      },
      { uri: pathToFileURL(external).href, range },
      { uri: "https://example.com/library.ts", range },
    ], instance)).toEqual([
      { path: "src/source.ts", line: 4, column: 7, endLine: 4, endColumn: 13 },
      { path: "src/linked.ts", line: 2, column: 3, endLine: 2, endColumn: 9 },
    ])
  })

  test("keeps hoisted dependency definitions under an approved worktree root", () => {
    const worktree = path.resolve(".tmp-workbench-monorepo")
    const directory = path.join(worktree, "packages", "app")
    const dependency = path.join(worktree, "node_modules", "library", "index.d.ts")
    const instance: InstanceContext = {
      directory,
      worktree,
      project: {} as InstanceContext["project"],
    }

    expect(workbenchDefinitionLocations([{
      uri: pathToFileURL(dependency).href,
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
    }], instance)).toEqual([{
      path: "node_modules/library/index.d.ts",
      root: worktree.replaceAll("\\", "/"),
      readOnly: true,
      line: 5,
      column: 3,
      endLine: 5,
      endColumn: 9,
    }])
  })

  test("normalizes bounded LSP hover content and source ranges", () => {
    expect(workbenchHoverResult([{
      contents: [
        { language: "typescript", value: "const helper: () => string" },
        { kind: "markdown", value: "Returns a helper value." },
      ],
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
    }])).toEqual({
      supported: true,
      contents: [
        { kind: "code", language: "typescript", value: "const helper: () => string" },
        { kind: "markdown", value: "Returns a helper value." },
      ],
      definitions: [],
      range: { line: 3, column: 5, endLine: 3, endColumn: 11 },
    })
  })

  test("normalizes bounded LSP completion details", () => {
    expect(workbenchCompletionResult([{
      label: "map",
      detail: "Array.map callback",
      documentation: { kind: "markdown", value: "Transforms each item." },
      insertText: "map(${1:callback})",
      insertTextFormat: 2,
      kind: 2,
    }])).toEqual({
      supported: true,
      items: [{
        label: "map",
        detail: "Array.map callback",
        documentation: "Transforms each item.",
        insertText: "map(${1:callback})",
        insertTextFormat: 2,
        kind: 2,
      }],
    })
  })

  test("recognizes relative and package import strings only at the requested position", () => {
    const content = "import { helper } from \"./helper\"\nimport { signal } from \"solid-js\"\nconst label = \"./not-an-import\""
    expect(workbenchRelativeImport(content, 1, 28)).toEqual({
      specifier: "./helper",
      line: 1,
      column: 25,
      endLine: 1,
      endColumn: 33,
    })
    expect(workbenchRelativeImport(content, 2, 26)?.specifier).toBe("solid-js")
    expect(workbenchRelativeImport(content, 3, 18)).toBeUndefined()
  })

  it.instance("reports unavailable file checkers without running a project fallback", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(instance.directory, "notes.unknown-lsp"), "unsaved buffer"))
      const result = yield* Effect.gen(function* () {
        const handlers = yield* makeOpencodeXWorkbenchFileHandlers()
        return {
          diagnostics: yield* handlers.workbenchFileDiagnostics({
            payload: { path: "notes.unknown-lsp", content: "new unsaved buffer" },
          }),
          definition: yield* handlers.workbenchFileDefinition({
            payload: { path: "../outside.ts", content: "", line: 1, column: 1 },
          }),
        }
      }).pipe(
        Effect.provideService(LSP.Service, unavailableLsp),
        Effect.provide(AppFileSystem.defaultLayer),
      )

      expect(result.diagnostics).toEqual({
        ok: true,
        supported: false,
        message: "No file checker available.",
        diagnostics: [],
      })
      expect(result.definition).toEqual([])
    }),
  )

  it.instance("synchronizes unsaved text and one-based GUI positions before LSP requests", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const file = path.join(instance.directory, "app.ts")
      yield* Effect.promise(() => Bun.write(file, "const disk = true"))
      const touches: Array<{ file: string; mode?: "document" | "full"; content?: string }> = []
      const positions: Array<{ file: string; line: number; character: number; workbench?: boolean }> = []
      const lsp: LSP.Interface = {
        ...unavailableLsp,
        workbenchPrepare: (target, content) => Effect.sync(() => {
          touches.push({ file: target, content })
          return true
        }),
        diagnostics: () => Effect.succeed({
          [Filesystem.normalizePath(file)]: [{
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
            severity: 1,
            message: "Unsaved error",
          }],
        }),
        definition: (position) => Effect.sync(() => {
          positions.push(position)
          return [{
            uri: pathToFileURL(file).href,
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
          }]
        }),
      }
      const result = yield* Effect.gen(function* () {
        const handlers = yield* makeOpencodeXWorkbenchFileHandlers()
        return {
          diagnostics: yield* handlers.workbenchFileDiagnostics({
            payload: { path: "app.ts", content: "const unsaved = missing" },
          }),
          definitions: yield* handlers.workbenchFileDefinition({
            payload: { path: "app.ts", content: "const unsaved = missing", line: 1, column: 17 },
          }),
        }
      }).pipe(
        Effect.provideService(LSP.Service, lsp),
        Effect.provide(AppFileSystem.defaultLayer),
      )

      expect(touches.map((touch) => ({ mode: touch.mode, content: touch.content }))).toEqual([
        { mode: undefined, content: "const unsaved = missing" },
        { mode: undefined, content: "const unsaved = missing" },
      ])
      expect(positions).toEqual([{ file, line: 0, character: 16, workbench: true }])
      expect(result.diagnostics.diagnostics[0]).toEqual({
        path: "app.ts", line: 1, column: 7, endLine: 1, endColumn: 13, severity: "error", message: "Unsaved error",
      })
      expect(result.definitions).toEqual([{ path: "app.ts", line: 1, column: 7, endLine: 1, endColumn: 13 }])
    }),
  )

  it.instance("resolves extensionless relative imports without a language server", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* Effect.promise(() => Promise.all([
        Bun.write(path.join(instance.directory, "app.ts"), "import { helper } from './helper'"),
        Bun.write(path.join(instance.directory, "helper.ts"), "export const helper = true"),
      ]))
      const result = yield* Effect.gen(function* () {
        const handlers = yield* makeOpencodeXWorkbenchFileHandlers()
        const payload = { path: "app.ts", content: "import { helper } from './helper'", line: 1, column: 28 }
        return {
          definition: yield* handlers.workbenchFileDefinition({ payload }),
          hover: yield* handlers.workbenchFileHover({ payload }),
        }
      }).pipe(
        Effect.provideService(LSP.Service, unavailableLsp),
        Effect.provide(AppFileSystem.defaultLayer),
      )

      expect(result.definition).toEqual([{ path: "helper.ts", line: 1, column: 1, endLine: 1, endColumn: 1 }])
      expect(result.hover).toEqual({
        supported: true,
        contents: [
          { kind: "code", value: "./helper" },
          { kind: "plaintext", value: "Module helper.ts" },
        ],
        definitions: [{ path: "helper.ts", line: 1, column: 1, endLine: 1, endColumn: 1 }],
        range: { line: 1, column: 25, endLine: 1, endColumn: 33 },
      })
    }),
  )
})

const unavailableLsp: LSP.Interface = {
  init: () => Effect.void,
  status: () => Effect.succeed([]),
  hasClients: () => Effect.succeed(false),
  workbenchPrepare: () => Effect.succeed(false),
  completion: () => Effect.succeed([]),
  touchFile: () => Effect.void,
  diagnostics: () => Effect.succeed({}),
  hover: () => Effect.succeed(null),
  definition: () => Effect.succeed([]),
  references: () => Effect.succeed([]),
  implementation: () => Effect.succeed([]),
  documentSymbol: () => Effect.succeed([]),
  workspaceSymbol: () => Effect.succeed([]),
  prepareCallHierarchy: () => Effect.succeed([]),
  incomingCalls: () => Effect.succeed([]),
  outgoingCalls: () => Effect.succeed([]),
}
