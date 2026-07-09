export * as Git from "./git"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "./schema"
import { AppFileSystem } from "./filesystem"
import { AppProcess } from "./process"
import { ChildProcess } from "effect/unstable/process"

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
  readonly root: (repo: Repo) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitV2") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const process = yield* AppProcess.Service

    const find = Effect.fn("Git.find")(function* (input: AbsolutePath) {
      const result = yield* process
        .run(ChildProcess.make("git", ["-C", input, "rev-parse", "--show-toplevel", "--git-common-dir"]))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result || result.exitCode !== 0) return undefined
      const [directory, store] = result.stdout.toString("utf8").trim().split(/\r?\n/)
      if (!directory || !store) return undefined

      return {
        directory: AbsolutePath.make(AppFileSystem.resolve(directory)),
        store: AbsolutePath.make(AppFileSystem.resolve(path.isAbsolute(store) ? store : path.join(input, store))),
      } satisfies Repo
    })

    const remote = Effect.fn("Git.remote")(function* (repo: Repo, name = "origin") {
      return yield* readRemoteUrl(fs, repo.store, name)
    })

    const root = Effect.fn("Git.root")(function* (repo: Repo) {
      const result = yield* process
        .run(ChildProcess.make("git", ["-C", repo.directory, "rev-list", "--max-parents=0", "HEAD"]))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result || result.exitCode !== 0) return undefined
      return result.stdout.toString("utf8").trim() || undefined
    })

    return Service.of({ find, remote, root })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
)

const sectionPattern = /^\s*\[([^\]]+)\]\s*$/
const remoteSectionPattern = /^remote\s+"(.+)"$/
const keyValuePattern = /^\s*([^=#;]+?)\s*=\s*(.*?)\s*$/

function readRemoteUrl(fs: AppFileSystem.Interface, gitDir: string, name: string) {
  return Effect.gen(function* () {
    const content = yield* readFileString(fs, path.join(gitDir, "config"))
    if (!content) return undefined

    return content.split(/\r?\n/).reduce<{ section?: string; url?: string }>((acc, line) => {
      const section = line.match(sectionPattern)
      if (section) return { section: section[1] }

      const remote = acc.section?.match(remoteSectionPattern)
      if (!remote || remote[1] !== name) return acc

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
