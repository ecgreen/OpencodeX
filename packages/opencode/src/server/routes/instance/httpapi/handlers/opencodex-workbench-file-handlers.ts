import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import {
  WorkbenchFileCreatePayload,
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

  const workbenchFileRead = Effect.fn("OpencodeXHttpApi.workbenchFileRead")(function* (ctx: {
    query: typeof WorkbenchFileReadQuery.Type
  }) {
    const target = workbenchPath(ctx.query.path, yield* InstanceState.context)
    if (!target) return workbenchFailure("escape", "Path is outside the active workspace.")
    const content = yield* fs.readFileStringSafe(target).pipe(Effect.orDie)
    if (content === undefined) return workbenchFailure("missing", "File does not exist.")
    if (binaryText(content)) return workbenchFailure("binary", "Workbench reads are text-only.")
    return { ok: true, content }
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

  return { workbenchFileRead, workbenchFileWrite, workbenchFileCreate, workbenchFileRename, workbenchFileDelete }
})
