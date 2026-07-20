import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import path from "path"
import {
  decodeWorkbenchCursor,
  encodeWorkbenchCursor,
  findWorkbenchSnapshot,
  type WorkbenchChangeFile,
  type WorkbenchChangeSnapshot,
  type WorkbenchPatchCache,
} from "./workbench-change-snapshot"
import {
  createWorkbenchSnapshot,
  normalizeRelative,
  runWorkbenchGit,
  WORKBENCH_PATCH_PAGE_BYTES,
} from "./workbench-changes"

const DEFAULT_PATCH_BYTES = 2 * 1024 * 1024

export const loadWorkbenchChangePatchPage = Effect.fn("WorkbenchChanges.patchPage")(function* (input: {
  path: string
  revision: string
  cursor?: string
  context?: number
}) {
  const instance = yield* InstanceState.context
  const file = normalizeRelative(input.path)
  const snapshot = findWorkbenchSnapshot(instance.directory, input.revision)
  const cursor = decodeWorkbenchCursor(input.cursor)
  if (!snapshot || cursor && (cursor.revision !== input.revision || cursor.path !== file)) {
    return failedPatch(file, input.revision, "The change snapshot is stale. Refresh to continue.", "modified", true)
  }
  const descriptor = snapshot.files.find((item) => item.path === file)
  if (!descriptor) return failedPatch(file, snapshot.revision, "The changed path no longer exists.", "modified", true)
  const patch = yield* cachedPatch(snapshot, descriptor, input.context ?? 8).pipe(Effect.catch(() => Effect.succeed({
    ok: false as const,
    stale: false,
    status: descriptor.status,
    message: "Unable to load file patch.",
  })))
  if (!patch.ok) return { ...patch, revision: snapshot.revision, path: file, binary: false, complete: true }
  const index = cursor?.index ?? 0
  const page = patch.value.pages[index]
  return {
    ok: true,
    stale: false,
    path: file,
    revision: snapshot.revision,
    status: patch.value.status,
    ...(page ? { patch: page } : {}),
    additions: patch.value.additions,
    deletions: patch.value.deletions,
    binary: patch.value.binary,
    complete: index + 1 >= patch.value.pages.length,
    ...(index + 1 < patch.value.pages.length
      ? { next: encodeWorkbenchCursor({ revision: snapshot.revision, path: file, index: index + 1 }) }
      : {}),
    ...(patch.value.message ? { message: patch.value.message } : {}),
  }
})

export const loadWorkbenchChangePatch = Effect.fn("WorkbenchChanges.patch")(function* (input: {
  path: string
  revision?: string
  context?: number
  maxBytes?: number
}) {
  const instance = yield* InstanceState.context
  const file = normalizeRelative(input.path)
  const snapshot = input.revision
    ? findWorkbenchSnapshot(instance.directory, input.revision)
    : yield* createWorkbenchSnapshot().pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!snapshot) return failedLegacyPatch(file, input.revision ?? "", "The change snapshot is stale. Refresh to continue.", "modified", true)
  const descriptor = snapshot.files.find((item) => item.path === file)
  if (!descriptor) return failedLegacyPatch(file, snapshot.revision, "The changed path no longer exists.", "modified", true)
  const patch = yield* cachedPatch(snapshot, descriptor, input.context ?? 8).pipe(Effect.catch(() => Effect.succeed({
    ok: false as const,
    stale: false,
    status: descriptor.status,
    message: "Unable to load file patch.",
  })))
  if (!patch.ok) return failedLegacyPatch(file, snapshot.revision, patch.message, patch.status, patch.stale)
  const maxBytes = input.maxBytes ?? DEFAULT_PATCH_BYTES
  if (patch.value.patch && Buffer.byteLength(patch.value.patch) > maxBytes) {
    return {
      ok: true,
      stale: false,
      path: file,
      revision: snapshot.revision,
      status: patch.value.status,
      additions: patch.value.additions,
      deletions: patch.value.deletions,
      binary: patch.value.binary,
      truncated: true,
      message: `Patch exceeds ${maxBytes} bytes.`,
    }
  }
  return {
    ok: true,
    stale: false,
    path: file,
    revision: snapshot.revision,
    status: patch.value.status,
    ...(patch.value.patch ? { patch: patch.value.patch } : {}),
    additions: patch.value.additions,
    deletions: patch.value.deletions,
    binary: patch.value.binary,
    truncated: false,
    ...(patch.value.message ? { message: patch.value.message } : {}),
  }
})

const cachedPatch = Effect.fnUntraced(function* (
  snapshot: WorkbenchChangeSnapshot,
  file: WorkbenchChangeFile,
  context: number,
) {
  const key = `${context}:${file.path}`
  const existing = snapshot.patches.get(key)
  if (existing) return { ok: true as const, value: existing }
  const loaded = snapshot.mode === "git" && !file.untracked
    ? yield* trackedPatch(snapshot, file, context)
    : yield* addedPatch(snapshot, file)
  if (!loaded.ok) return loaded
  snapshot.patches.clear()
  snapshot.patches.set(key, loaded.value)
  return loaded
})

const trackedPatch = Effect.fnUntraced(function* (
  snapshot: WorkbenchChangeSnapshot,
  file: WorkbenchChangeFile,
  context: number,
) {
  const result = yield* runWorkbenchGit(snapshot.directory, [
    "diff",
    snapshot.baseline ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    "--patch",
    "--no-ext-diff",
    "--no-renames",
    `--unified=${context}`,
    "--",
    file.path,
  ])
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    return {
      ok: false as const,
      stale: false,
      status: file.status,
      message: result.stderr.toString("utf8").trim() || "Unable to load file patch.",
    }
  }
  return { ok: true as const, value: patchCache(file.status, result.stdout.toString("utf8")) }
})

const addedPatch = Effect.fnUntraced(function* (snapshot: WorkbenchChangeSnapshot, file: WorkbenchChangeFile) {
  const fs = yield* AppFileSystem.Service
  const target = path.resolve(snapshot.directory, file.path)
  if (!file.openable || !AppFileSystem.contains(snapshot.directory, target) || !(yield* fs.isFile(target))) {
    return { ok: false as const, stale: true, status: file.status, message: "The changed path no longer exists." }
  }
  const content = yield* fs.readFile(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!content) return { ok: false as const, stale: true, status: file.status, message: "The changed path no longer exists." }
  if (content.includes(0)) {
    return {
      ok: true as const,
      value: {
        status: file.status,
        pages: [],
        additions: 0,
        deletions: 0,
        binary: true,
        message: "Binary patch is not displayed.",
      } satisfies WorkbenchPatchCache,
    }
  }
  const text = Buffer.from(content).toString("utf8")
  const lines = text ? text.split("\n") : []
  if (lines.at(-1) === "") lines.pop()
  const patch = [
    `diff --git a/${file.path} b/${file.path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file.path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line.replace(/\r$/, "")}`),
    ...(text && !text.endsWith("\n") ? ["\\ No newline at end of file"] : []),
  ].join("\n")
  return { ok: true as const, value: patchCache(file.status, patch) }
})

function patchCache(status: WorkbenchChangeFile["status"], patch: string): WorkbenchPatchCache {
  const binary = /(?:Binary files .* differ|GIT binary patch)/.test(patch)
  const stats = patchStats(patch)
  return {
    status,
    ...(patch && !binary ? { patch } : {}),
    pages: patch && !binary ? splitPatchPages(patch) : [],
    additions: stats.additions,
    deletions: stats.deletions,
    binary,
    ...(binary ? { message: "Binary patch is not displayed." } : {}),
  }
}

function splitPatchPages(patch: string) {
  const lines = patch.split("\n")
  const starts = lines.flatMap((line, index) => line.startsWith("@@ ") ? [index] : [])
  if (starts.length === 0 || Buffer.byteLength(patch) <= WORKBENCH_PATCH_PAGE_BYTES) return [patch]
  const header = lines.slice(0, starts[0])
  const budget = Math.max(1024, WORKBENCH_PATCH_PAGE_BYTES - Buffer.byteLength(header.join("\n")))
  const hunks = starts.flatMap((start, index) => splitHunk(lines.slice(start, starts[index + 1] ?? lines.length), budget))
  const pages = hunks.reduce((pages, hunk) => {
    const candidate = [...header, ...(pages.pending ?? []), ...hunk].join("\n")
    if (!pages.pending || Buffer.byteLength(candidate) <= WORKBENCH_PATCH_PAGE_BYTES) {
      return { complete: pages.complete, pending: [...(pages.pending ?? []), ...hunk] }
    }
    return { complete: [...pages.complete, [...header, ...pages.pending].join("\n")], pending: hunk }
  }, { complete: [] as string[], pending: undefined as string[] | undefined })
  return [...pages.complete, ...(pages.pending ? [[...header, ...pages.pending].join("\n")] : [])]
}

function splitHunk(hunk: string[], budget: number) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(hunk[0] ?? "")
  if (!match || Buffer.byteLength(hunk.join("\n")) <= budget) return [hunk]
  const chunks: string[][] = []
  const suffix = match[5] ?? ""
  let oldLine = Number(match[1])
  let newLine = Number(match[3])
  let oldStart = oldLine
  let newStart = newLine
  let size = 0
  let body: string[] = []
  const flush = () => {
    if (body.length === 0) return
    const counts = hunkCounts(body)
    chunks.push([`@@ -${oldStart},${counts.old} +${newStart},${counts.next} @@${suffix}`, ...body])
    body = []
    size = 0
    oldStart = oldLine
    newStart = newLine
  }
  hunk.slice(1).forEach((line) => {
    const bytes = Buffer.byteLength(line) + 1
    if (!line.startsWith("\\") && body.length > 0 && size + bytes > budget) flush()
    body.push(line)
    size += bytes
    if (line.startsWith("\\")) return
    if (!line.startsWith("+")) oldLine++
    if (!line.startsWith("-")) newLine++
  })
  flush()
  return chunks
}

function hunkCounts(lines: string[]) {
  return lines.reduce((counts, line) => ({
    old: counts.old + Number(!line.startsWith("+") && !line.startsWith("\\")),
    next: counts.next + Number(!line.startsWith("-") && !line.startsWith("\\")),
  }), { old: 0, next: 0 })
}

function patchStats(patch: string) {
  return patch.split(/\r?\n/).reduce((stats, line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) stats.additions++
    if (line.startsWith("-") && !line.startsWith("---")) stats.deletions++
    return stats
  }, { additions: 0, deletions: 0 })
}

function failedPatch(
  path: string,
  revision: string,
  message: string,
  status: WorkbenchChangeFile["status"],
  stale: boolean,
) {
  return { ok: false, stale, path, revision, status, binary: false, complete: true, message }
}

function failedLegacyPatch(
  path: string,
  revision: string,
  message: string,
  status: WorkbenchChangeFile["status"],
  stale: boolean,
) {
  return { ok: false, stale, path, revision, status, binary: false, truncated: false, message }
}
