export * as Git from "./git"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "./schema"
import { AppFileSystem } from "./filesystem"

export interface Repo {
  /**
   * The root directory of the working tree that contains the input path.
   *
   * For `/home/me/app/src/file.ts` in a normal clone, this is `/home/me/app`.
   * For `/home/me/app-feature/src/file.ts` in a linked worktree, this is
   * `/home/me/app-feature`.
   */
  readonly directory: AbsolutePath
  /**
   * The shared Git storage directory used by this repo and any linked worktrees.
   *
   * For a normal clone at `/home/me/app`, this is usually `/home/me/app/.git`.
   * For a linked worktree at `/home/me/app-feature` whose main checkout is
   * `/home/me/app`, this is usually `/home/me/app/.git`.
   */
  readonly store: AbsolutePath
}

export interface Interface {
  readonly find: (input: AbsolutePath) => Effect.Effect<Repo | undefined>
  readonly remote: (repo: Repo, name?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitV2") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const find = Effect.fn("Git.find")(function* (input: AbsolutePath) {
      const dotgit = yield* fs.up({ targets: [".git"], start: input }).pipe(
        Effect.map((matches) => matches[0]),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!dotgit) return undefined

      const cwd = path.dirname(dotgit)
      const gitDir = yield* resolveGitDir(fs, cwd, dotgit)
      if (!gitDir) return undefined

      return {
        directory: AbsolutePath.make(AppFileSystem.resolve(cwd)),
        store: AbsolutePath.make(yield* resolveCommonDir(fs, gitDir)),
      } satisfies Repo
    })

    const remote = Effect.fn("Git.remote")(function* (repo: Repo, name = "origin") {
      return yield* readRemoteUrl(fs, repo.store, name)
    })

    return Service.of({ find, remote })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

const gitdirPattern = /^gitdir:\s*(.+)$/i
const sectionPattern = /^\s*\[([^\]]+)\]\s*$/
const remoteSectionPattern = /^remote\s+"(.+)"$/
const keyValuePattern = /^\s*([^=#;]+?)\s*=\s*(.*?)\s*$/

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

function readRemoteUrl(fs: AppFileSystem.Interface, gitDir: string, name: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(gitDir, "config"))
    if (!content) return undefined

    return content.split(/\r?\n/).reduce<{ section?: string; url?: string }>((acc, line) => {
      const section = line.match(sectionPattern)
      if (section) return { section: section[1]! }

      const remote = acc.section?.match(remoteSectionPattern)
      if (!remote || remote[1]! !== name) return acc

      const keyValue = line.match(keyValuePattern)
      if (!keyValue || keyValue[1]?.trim() !== "url") return acc
      const url = keyValue[2]?.trim()
      return url ? { ...acc, url } : acc
    }, {}).url
  })
}

function readFileString(fs: AppFileSystem.Interface, file: string) {
  return fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function resolvePath(cwd: string, value: string) {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = AppFileSystem.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
