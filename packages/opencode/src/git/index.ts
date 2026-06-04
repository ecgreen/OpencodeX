import { AppProcess } from "@opencode-ai/core/process"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer, Context, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"

const cfg = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

const out = (result: { text(): string }) => result.text().trim()
const nuls = (text: string) => text.split("\0").filter(Boolean)
const fail = (err: unknown) =>
  ({
    exitCode: 1,
    text: () => "",
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
    truncated: false,
  }) satisfies Result

export type Kind = "added" | "deleted" | "modified"

export type Base = {
  readonly name: string
  readonly ref: string
}

export type Item = {
  readonly file: string
  readonly code: string
  readonly status: Kind
}

export type Stat = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
}

export type Patch = {
  readonly text: string
  readonly truncated: boolean
}

export interface PatchOptions {
  readonly context?: number
  readonly maxOutputBytes?: number
}

export interface Result {
  readonly exitCode: number
  readonly text: () => string
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly truncated: boolean
}

export interface Options {
  readonly cwd: string
  readonly env?: Record<string, string>
  readonly maxOutputBytes?: number
  readonly stdin?: ChildProcess.CommandInput
}

export interface Interface {
  readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
  readonly gitDir: (cwd: string) => Effect.Effect<string | undefined>
  readonly branch: (cwd: string) => Effect.Effect<string | undefined>
  readonly prefix: (cwd: string) => Effect.Effect<string>
  readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
  readonly hasHead: (cwd: string) => Effect.Effect<boolean>
  readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
  readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
  readonly status: (cwd: string) => Effect.Effect<Item[]>
  readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
  readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
  readonly patch: (cwd: string, ref: string, file: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly patchAll: (cwd: string, ref: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly patchUntracked: (cwd: string, file: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly statUntracked: (cwd: string, file: string) => Effect.Effect<Stat | undefined>
  readonly applyPatch: (cwd: string, patch: string) => Effect.Effect<Result>
}

const kind = (code: string): Kind => {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Git") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const fs = yield* AppFileSystem.Service
    const encoder = new TextEncoder()
    const stdin = (text: string) => Stream.make(encoder.encode(text))

    const run = Effect.fn("Git.run")(
      function* (args: string[], opts: Options) {
        const result = yield* appProcess.run(
          ChildProcess.make("git", [...cfg, ...args], {
            cwd: opts.cwd,
            env: opts.env,
            extendEnv: true,
            stdin: opts.stdin ?? "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }),
          { maxOutputBytes: opts.maxOutputBytes },
        )
        return {
          exitCode: result.exitCode,
          text: () => result.stdout.toString("utf8"),
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.stdoutTruncated || result.stderrTruncated,
        } satisfies Result
      },
      Effect.catch((err) => Effect.succeed(fail(err))),
    )

    const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
      return (yield* run(args, opts)).text()
    })

    const repository = Effect.fnUntraced(function* (cwd: string) {
      return yield* resolveRepository(fs, cwd)
    })

    const gitDir = Effect.fn("Git.gitDir")(function* (cwd: string) {
      return (yield* repository(cwd))?.gitDir
    })

    const refs = Effect.fnUntraced(function* (store: string) {
      return yield* readRefs(fs, store, "refs/heads")
    })

    const configured = Effect.fnUntraced(function* (store: string, list: string[]) {
      const name = yield* readConfigValue(fs, store, "init", undefined, "defaultBranch")
      if (!name || !list.includes(name)) return
      return { name, ref: name } satisfies Base
    })

    const primary = Effect.fnUntraced(function* (store: string) {
      const list = yield* readRemotes(fs, store)
      if (list.includes("origin")) return "origin"
      if (list.length === 1) return list[0]
      if (list.includes("upstream")) return "upstream"
      return list[0]
    })

    const branch = Effect.fn("Git.branch")(function* (cwd: string) {
      const repo = yield* repository(cwd)
      if (!repo) return
      return yield* readHeadBranch(fs, repo.gitDir)
    })

    const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
      if (result.exitCode !== 0) return ""
      return out(result)
    })

    const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
      const repo = yield* repository(cwd)
      if (!repo) return

      const remote = yield* primary(repo.store)
      if (remote) {
        const head = yield* readRemoteHead(fs, repo.store, remote)
        if (head) return head
      }

      const list = yield* refs(repo.store)
      const next = yield* configured(repo.store, list)
      if (next) return next
      if (list.includes("main")) return { name: "main", ref: "main" } satisfies Base
      if (list.includes("master")) return { name: "master", ref: "master" } satisfies Base
    })

    const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
      return result.exitCode === 0
    })

    const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
      const result = yield* run(["merge-base", base, head], { cwd })
      if (result.exitCode !== 0) return
      const text = out(result)
      return text || undefined
    })

    const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
      const target = prefix ? `${prefix}${file}` : file
      const result = yield* run(["show", `${ref}:${target}`], { cwd })
      if (result.exitCode !== 0) return ""
      if (result.stdout.includes(0)) return ""
      return result.text()
    })

    const status = Effect.fn("Git.status")(function* (cwd: string) {
      return nuls(
        yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], {
          cwd,
        }),
      ).flatMap((item) => {
        const file = item.slice(3)
        if (!file) return []
        const code = item.slice(0, 2)
        return [{ file, code, status: kind(code) } satisfies Item]
      })
    })

    const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
      const list = nuls(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
      )
      return list.flatMap((code, idx) => {
        if (idx % 2 !== 0) return []
        const file = list[idx + 1]
        if (!code || !file) return []
        return [{ file, code, status: kind(code) } satisfies Item]
      })
    })

    const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
      return nuls(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
      ).flatMap((item) => {
        const a = item.indexOf("\t")
        const b = item.indexOf("\t", a + 1)
        if (a === -1 || b === -1) return []
        const file = item.slice(b + 1)
        if (!file) return []
        const adds = item.slice(0, a)
        const dels = item.slice(a + 1, b)
        const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
        const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
        return [
          {
            file,
            additions: Number.isFinite(additions) ? additions : 0,
            deletions: Number.isFinite(deletions) ? deletions : 0,
          } satisfies Stat,
        ]
      })
    })

    const patch = Effect.fn("Git.patch")(function* (cwd: string, ref: string, file: string, options?: PatchOptions) {
      const result = yield* run(
        ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", file],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
    })

    const patchAll = Effect.fn("Git.patchAll")(function* (cwd: string, ref: string, options?: PatchOptions) {
      const result = yield* run(
        ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", "."],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.text(), truncated: result.truncated } satisfies Patch
    })

    const patchUntracked = Effect.fn("Git.patchUntracked")(function* (
      cwd: string,
      file: string,
      options?: PatchOptions,
    ) {
      const result = yield* run(
        [
          "diff",
          "--no-index",
          "--patch",
          "--no-ext-diff",
          "--no-renames",
          `--unified=${options?.context ?? 3}`,
          "--",
          "/dev/null",
          file,
        ],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
    })

    const statUntracked = Effect.fn("Git.statUntracked")(function* (cwd: string, file: string) {
      const result = yield* run(["diff", "--no-index", "--numstat", "--", "/dev/null", file], {
        cwd,
        maxOutputBytes: 4096,
      })

      if (result.truncated) return
      const text = result.text()

      const parts = text.split("\t")
      if (parts.length < 2) return

      const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] || "0", 10)
      const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] || "0", 10)
      return {
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      } satisfies Stat
    })

    const applyPatch = Effect.fn("Git.applyPatch")(function* (cwd: string, patch: string) {
      return yield* run(["apply", "-"], { cwd, stdin: stdin(patch) })
    })

    return Service.of({
      run,
      gitDir,
      branch,
      prefix,
      defaultBranch,
      hasHead,
      mergeBase,
      show,
      status,
      diff,
      stats,
      patch,
      patchAll,
      patchUntracked,
      statUntracked,
      applyPatch,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as Git from "."

interface Repository {
  readonly gitDir: string
  readonly store: string
}

const gitdirPattern = /^gitdir:\s*(.+)$/i
const sectionPattern = /^\s*\[([^\]\s]+)(?:\s+"(.+)")?\]\s*$/
const keyValuePattern = /^\s*([^=#;]+?)\s*=\s*(.*?)\s*$/

function resolveRepository(fs: AppFileSystem.Interface, cwd: string) {
  return Effect.gen(function* () {
    const dotgit = yield* fs.up({ targets: [".git"], start: cwd }).pipe(
      Effect.map((matches) => matches[0]),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (!dotgit) return undefined

    const gitDir = yield* resolveGitDir(fs, path.dirname(dotgit), dotgit)
    if (!gitDir) return undefined
    const store = yield* resolveCommonDir(fs, gitDir)
    return { gitDir, store } satisfies Repository
  })
}

function resolveGitDir(fs: AppFileSystem.Interface, cwd: string, dotgit: string) {
  return Effect.gen(function* () {
    if (yield* fs.isDir(dotgit)) return AppFileSystem.resolve(dotgit)

    const content = yield* readFileString(fs, dotgit)
    const match = content?.match(gitdirPattern)
    if (!match) return undefined
    return AppFileSystem.resolve(resolvePath(cwd, match[1]!))
  })
}

function resolveCommonDir(fs: AppFileSystem.Interface, gitDir: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(gitDir, "commondir"))
    return content ? AppFileSystem.resolve(resolvePath(gitDir, content)) : AppFileSystem.resolve(gitDir)
  })
}

function readHeadBranch(fs: AppFileSystem.Interface, gitDir: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(gitDir, "HEAD"))
    return parseHead(content, "refs/heads/")
  })
}

function readRemoteHead(fs: AppFileSystem.Interface, store: string, remote: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(store, "refs", "remotes", remote, "HEAD"))
    const ref = parseHead(content, "refs/remotes/")
    if (!ref?.startsWith(`${remote}/`)) return undefined
    return { name: ref.slice(remote.length + 1), ref } satisfies Base
  })
}

function readRemotes(fs: AppFileSystem.Interface, store: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(store, "config"))
    if (!content) return []
    return content.split(/\r?\n/).reduce<string[]>((acc, line) => {
      const section = line.match(sectionPattern)
      if (!section || section[1]! !== "remote" || !section[2]) return acc
      return acc.includes(section[2]) ? acc : [...acc, section[2]]
    }, [])
  })
}

function readConfigValue(
  fs: AppFileSystem.Interface,
  store: string,
  sectionName: string,
  subsection: string | undefined,
  key: string,
) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(store, "config"))
    if (!content) return undefined

    return content.split(/\r?\n/).reduce<{ section?: string; subsection?: string; value?: string }>((acc, line) => {
      const section = line.match(sectionPattern)
      if (section?.[2]) return { section: section[1]!, subsection: section[2] }
      if (section) return { section: section[1]! }
      if (acc.section !== sectionName || acc.subsection !== subsection) return acc

      const keyValue = line.match(keyValuePattern)
      if (!keyValue || keyValue[1]?.trim() !== key) return acc
      const value = keyValue[2]?.trim()
      return value ? { ...acc, value } : acc
    }, {}).value
  })
}

function readRefs(fs: AppFileSystem.Interface, store: string, refPrefix: string) {
  return Effect.gen(function* () {
    const loose = yield* readLooseRefs(fs, path.join(store, ...refPrefix.split("/")))
    const packed = yield* readPackedRefs(fs, store, refPrefix)
    return [...new Set([...loose, ...packed])].toSorted()
  })
}

function readLooseRefs(fs: AppFileSystem.Interface, dir: string) {
  return Effect.gen(function* () {
    return (yield* fs.glob("**", { cwd: dir, include: "file" }).pipe(Effect.catch(() => Effect.succeed([])))).map(
      (ref) => ref.replaceAll("\\", "/"),
    )
  })
}

function readPackedRefs(fs: AppFileSystem.Interface, store: string, refPrefix: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(store, "packed-refs"))
    if (!content) return []
    return content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("^"))
      .flatMap((line) => {
        const ref = line.split(" ")[1]
        if (!ref?.startsWith(`${refPrefix}/`)) return []
        return [ref.slice(refPrefix.length + 1)]
      })
  })
}

function readFileString(fs: AppFileSystem.Interface, file: string) {
  return fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function parseHead(content: string | undefined, prefix: string) {
  const ref = content?.trim().match(/^ref:\s*(.+)$/)?.[1]
  if (!ref?.startsWith(prefix)) return undefined
  return ref.slice(prefix.length)
}

function resolvePath(cwd: string, value: string) {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = AppFileSystem.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
