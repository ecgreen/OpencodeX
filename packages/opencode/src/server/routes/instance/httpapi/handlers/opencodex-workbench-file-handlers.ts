import { InstanceState } from "@/effect/instance-state"
import { LSP } from "@/lsp/lsp"
import {
  fileWorkbenchDiagnostics,
  workbenchCompletionResult,
  workbenchDefinitionLocations,
  workbenchHoverResult,
  workbenchRelativeImport,
} from "@/opencodex/workbench-diagnostics"
import { workbenchFileTarget, workbenchReadPath } from "@/opencodex/workbench-path"
import type { InstanceContext } from "@/project/instance-context"
import { Filesystem } from "@/util/filesystem"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Module } from "@opencode-ai/core/util/module"
import { Effect, Option } from "effect"
import path from "path"
import {
  WorkbenchFileCreatePayload,
  WorkbenchFileAnalysisPayload,
  WorkbenchFileDefinitionPayload,
  WorkbenchFileCompletionPayload,
  WorkbenchFileDeletePayload,
  WorkbenchFileReadQuery,
  WorkbenchFileRenamePayload,
  WorkbenchFileWritePayload,
} from "../groups/opencodex"
import {
  binaryText,
  workbenchFailure,
  workbenchPath,
  workbenchSuccess,
} from "./opencodex-workbench-common"

export const makeOpencodeXWorkbenchFileHandlers = Effect.fn("OpencodeXHttpApi.makeWorkbenchFileHandlers")(function* () {
  const fs = yield* AppFileSystem.Service
  const lsp = yield* LSP.Service

  const workbenchFileRead = Effect.fn("OpencodeXHttpApi.workbenchFileRead")(function* (ctx: {
    query: typeof WorkbenchFileReadQuery.Type
  }) {
    const target = workbenchReadPath(ctx.query.path, ctx.query.root, yield* InstanceState.context)
    if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
    const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.void))
    if (!info) return workbenchFailure("missing", "File does not exist.")
    const bounded = ctx.query.maxBytes === undefined
      ? undefined
      : yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* fs.open(target, { flag: "r" })
            return Option.getOrElse(yield* handle.readAlloc(ctx.query.maxBytes! + 1), () => new Uint8Array())
          }),
        ).pipe(Effect.orDie)
    const oversized = bounded !== undefined && bounded.byteLength > ctx.query.maxBytes!
    const bytes = bounded === undefined
      ? Number(info.size)
      : oversized
        ? Math.max(Number(info.size), bounded.byteLength)
        : bounded.byteLength
    if (oversized) return { ok: true, bytes, truncated: true }
    const content = bounded === undefined
      ? yield* fs.readFileStringSafe(target).pipe(Effect.orDie)
      : Buffer.from(bounded).toString("utf8")
    if (content === undefined) return workbenchFailure("missing", "File does not exist.")
    if (binaryText(content)) return workbenchFailure("binary", "Workbench reads are text-only.")
    return {
      ok: true,
      content,
      ...(ctx.query.maxBytes === undefined ? {} : { bytes, truncated: false }),
    }
  })

  const workbenchFileWrite = Effect.fn("OpencodeXHttpApi.workbenchFileWrite")(function* (ctx: {
    payload: typeof WorkbenchFileWritePayload.Type
  }) {
    if (binaryText(ctx.payload.content)) return workbenchFailure("binary", "Workbench writes are text-only.")
    const target = workbenchPath(ctx.payload.path, yield* InstanceState.context)
    if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
    const current = yield* fs.readFileStringSafe(target).pipe(Effect.orDie)
    if (current === undefined) return workbenchFailure("missing", "File does not exist.")
    if (binaryText(current)) return workbenchFailure("binary", "Workbench writes are text-only.")
    if (ctx.payload.previousContent !== undefined && current !== ctx.payload.previousContent) {
      return workbenchFailure("conflict", "File changed on disk. Review before saving.", current)
    }
    yield* fs.writeFileString(target, ctx.payload.content).pipe(Effect.orDie)
    return workbenchSuccess("Saved.")
  })

  const workbenchFileCreate = Effect.fn("OpencodeXHttpApi.workbenchFileCreate")(function* (ctx: {
    payload: typeof WorkbenchFileCreatePayload.Type
  }) {
    const content = ctx.payload.content ?? ""
    if (binaryText(content)) return workbenchFailure("binary", "Workbench creates text files only.")
    const target = workbenchPath(ctx.payload.path, yield* InstanceState.context)
    if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
    if (yield* fs.existsSafe(target)) return workbenchFailure("exists", "Path already exists.")
    if (ctx.payload.directory === true) {
      yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.orDie)
      return workbenchSuccess("Folder created.")
    }
    yield* fs.writeFileString(target, content).pipe(Effect.orDie)
    return workbenchSuccess("Created.")
  })

  const workbenchFileRename = Effect.fn("OpencodeXHttpApi.workbenchFileRename")(function* (ctx: {
    payload: typeof WorkbenchFileRenamePayload.Type
  }) {
    const instance = yield* InstanceState.context
    const from = workbenchPath(ctx.payload.from, instance)
    const to = workbenchPath(ctx.payload.to, instance)
    if (!from || !to) return workbenchFailure("escape", "Path is outside the active workspace.")
    if (!(yield* fs.existsSafe(from))) return workbenchFailure("missing", "Source file does not exist.")
    if (yield* fs.existsSafe(to)) return workbenchFailure("exists", "Target already exists.")
    yield* fs.rename(from, to).pipe(Effect.orDie)
    return workbenchSuccess("Renamed.")
  })

  const workbenchFileDelete = Effect.fn("OpencodeXHttpApi.workbenchFileDelete")(function* (ctx: {
    payload: typeof WorkbenchFileDeletePayload.Type
  }) {
    const target = workbenchPath(ctx.payload.path, yield* InstanceState.context)
    if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
    if (!(yield* fs.existsSafe(target))) return workbenchFailure("missing", "File does not exist.")
    if (yield* fs.isDir(target)) return workbenchFailure("directory", "Directory deletion is not supported in the preview Workbench.")
    yield* fs.remove(target).pipe(Effect.orDie)
    return workbenchSuccess("Deleted.")
  })

  const workbenchFileDiagnostics = Effect.fn("OpencodeXHttpApi.workbenchFileDiagnostics")(function* (ctx: {
    payload: typeof WorkbenchFileAnalysisPayload.Type
  }) {
    const target = workbenchReadPath(ctx.payload.path, ctx.payload.root, yield* InstanceState.context)
    if (!target) return { ...workbenchFailure("escape", "Path is outside the active workspace."), supported: false, diagnostics: [] }
    if (!(yield* fs.existsSafe(target))) return { ...workbenchFailure("missing", "File does not exist."), supported: false, diagnostics: [] }
    if (!(yield* lsp.workbenchPrepare(target, ctx.payload.content))) {
      return { ok: true, supported: false, message: "No file checker available.", diagnostics: [] }
    }
    const diagnostics = yield* lsp.diagnostics(true)
    return {
      ok: true,
      supported: true,
      diagnostics: fileWorkbenchDiagnostics(
        ctx.payload.path,
        diagnostics[Filesystem.normalizePath(target)] ?? [],
      ),
    }
  })

  const workbenchFileDefinition = Effect.fn("OpencodeXHttpApi.workbenchFileDefinition")(function* (ctx: {
    payload: typeof WorkbenchFileDefinitionPayload.Type
  }) {
    const instance = yield* InstanceState.context
    const target = workbenchReadPath(ctx.payload.path, ctx.payload.root, instance)
    if (!target || !(yield* fs.existsSafe(target))) return []
    if (yield* lsp.workbenchPrepare(target, ctx.payload.content)) {
      const locations = workbenchDefinitionLocations(
        yield* lsp.definition({
          file: target,
          line: ctx.payload.line - 1,
          character: ctx.payload.column - 1,
          workbench: true,
        }),
        instance,
      )
      if (locations.length > 0) return locations
    }
    const fallback = yield* resolveRelativeImport(ctx.payload, target, instance, fs)
    return fallback ? [fallback.location] : []
  })

  const workbenchFileHover = Effect.fn("OpencodeXHttpApi.workbenchFileHover")(function* (ctx: {
    payload: typeof WorkbenchFileDefinitionPayload.Type
  }) {
    const instance = yield* InstanceState.context
    const target = workbenchReadPath(ctx.payload.path, ctx.payload.root, instance)
    if (!target || !(yield* fs.existsSafe(target))) {
      return { supported: false, message: "File is outside the active workspace.", contents: [], definitions: [] }
    }
    const prepared = yield* lsp.workbenchPrepare(target, ctx.payload.content)
    // TEMPORARY CI PROBE
    yield* Effect.logInfo(
      `HOVERPROBE prepared=${prepared} target=${target} line=${ctx.payload.line} col=${ctx.payload.column} contentLen=${ctx.payload.content.length} contentHead=${JSON.stringify(ctx.payload.content.slice(0, 60))}`,
    )
    if (prepared) {
      const position = { file: target, line: ctx.payload.line - 1, character: ctx.payload.column - 1, workbench: true }
      const rawHover = yield* lsp.hover(position)
      const rawDefinition = yield* lsp.definition(position)
      // TEMPORARY CI PROBE
      yield* Effect.logInfo(`HOVERPROBE rawHover=${JSON.stringify(rawHover).slice(0, 600)}`)
      yield* Effect.logInfo(`HOVERPROBE rawDefinitionCount=${JSON.stringify(rawDefinition).slice(0, 300)}`)
      const result = workbenchHoverResult(rawHover, workbenchDefinitionLocations(rawDefinition, instance))
      if (result.contents.length > 0 || result.definitions.length > 0) return result
    }
    const fallback = yield* resolveRelativeImport(ctx.payload, target, instance, fs)
    if (!fallback) return { supported: false, message: "Language intelligence is unavailable.", contents: [], definitions: [] }
    return {
      supported: true,
      contents: [
        { kind: "code" as const, value: fallback.reference.specifier },
        { kind: "plaintext" as const, value: `Module ${fallback.location.path}` },
      ],
      definitions: [fallback.location],
      range: {
        line: fallback.reference.line,
        column: fallback.reference.column,
        endLine: fallback.reference.endLine,
        endColumn: fallback.reference.endColumn,
      },
    }
  })

  const workbenchFileCompletion = Effect.fn("OpencodeXHttpApi.workbenchFileCompletion")(function* (ctx: {
    payload: typeof WorkbenchFileCompletionPayload.Type
  }) {
    const instance = yield* InstanceState.context
    const target = workbenchReadPath(ctx.payload.path, ctx.payload.root, instance)
    if (!target || !(yield* fs.existsSafe(target))) {
      return { supported: false, message: "File is outside the active workspace.", items: [] }
    }
    if (!(yield* lsp.workbenchPrepare(target, ctx.payload.content))) {
      return { supported: false, message: "Language intelligence is unavailable.", items: [] }
    }
    return workbenchCompletionResult(yield* lsp.completion({
      file: target,
      line: ctx.payload.line - 1,
      character: ctx.payload.column - 1,
      workbench: true,
      context: ctx.payload.triggerKind ? {
        triggerKind: ctx.payload.triggerKind,
        ...(ctx.payload.triggerCharacter ? { triggerCharacter: ctx.payload.triggerCharacter } : {}),
      } : undefined,
    }))
  })

  return {
    workbenchFileRead,
    workbenchFileWrite,
    workbenchFileCreate,
    workbenchFileRename,
    workbenchFileDelete,
    workbenchFileDiagnostics,
    workbenchFileDefinition,
    workbenchFileHover,
    workbenchFileCompletion,
  }
})

const importExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"]

const resolveRelativeImport = Effect.fnUntraced(function* (
  input: typeof WorkbenchFileDefinitionPayload.Type,
  source: string,
  instance: InstanceContext,
  fs: AppFileSystem.Interface,
) {
  const reference = workbenchRelativeImport(input.content, input.line, input.column)
  if (!reference) return
  const bare = !reference.specifier.startsWith(".")
  const base = bare
    ? Module.resolve(reference.specifier, path.dirname(source))
    : path.resolve(path.dirname(source), reference.specifier)
  if (!base) return
  const extension = path.extname(base)
  const sourceExtension = path.extname(source)
  const substitutions = extension === ".js" || extension === ".jsx"
    ? [base.slice(0, -extension.length) + ".ts", base.slice(0, -extension.length) + ".tsx"]
    : extension === ".mjs"
      ? [base.slice(0, -extension.length) + ".mts"]
      : extension === ".cjs"
        ? [base.slice(0, -extension.length) + ".cts"]
        : []
  const extensions = [...new Set([sourceExtension, ...importExtensions].filter(Boolean))]
  const candidates = [...new Set([
    base,
    ...substitutions,
    ...(extension ? [] : extensions.map((item) => base + item)),
    ...(extension ? [] : extensions.map((item) => path.join(base, `index${item}`))),
  ])].flatMap((candidate) => workbenchFileTarget(candidate, instance) ? [candidate] : [])
  const files = yield* Effect.forEach(candidates, (candidate) => fs.isFile(candidate))
  const resolved = candidates.find((_, index) => files[index])
  if (!resolved) return
  const location = workbenchFileTarget(resolved, instance)
  if (!location) return
  return {
    reference,
    location: {
      ...location,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
    },
  }
})
