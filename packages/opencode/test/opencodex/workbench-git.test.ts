import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { File } from "../../src/file"
import { loadWorkbenchChangePatch, loadWorkbenchChangePatchPage } from "../../src/opencodex/workbench-change-patch"
import { workbenchChangeSummary } from "../../src/opencodex/workbench-change-snapshot"
import { listWorkbenchChanges, loadWorkbenchChangeMetrics, workbenchMode } from "../../src/opencodex/workbench-changes"
import { workbenchDiagnostics } from "../../src/opencodex/workbench-diagnostics"
import { workbenchGitHistory } from "../../src/opencodex/workbench-git"
import { makeOpencodeXWorkbenchGitHandlers } from "../../src/server/routes/instance/httpapi/handlers/opencodex-workbench-git-handlers"
import { TestInstance } from "../fixture/fixture"
import { it, testEffect } from "../lib/effect"

const tmpdirs: string[] = []
const changesIt = testEffect(Layer.mergeAll(File.defaultLayer, AppProcess.defaultLayer, AppFileSystem.defaultLayer))

afterEach(async () => {
  await Promise.all(tmpdirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("OpencodeX Workbench Git", () => {
  test("marks metrics complete after every changed file resolves", () => {
    expect(workbenchChangeSummary({
      directory: "C:/repo",
      revision: "revision",
      createdAt: Date.now(),
      mode: "git",
      files: [
        { type: "file", name: "text.ts", path: "text.ts", status: "modified", staged: false, unstaged: true, untracked: false, openable: true, additions: 2, deletions: 1, binary: false },
        { type: "file", name: "image.bin", path: "image.bin", status: "added", staged: false, unstaged: false, untracked: true, openable: true, additions: 0, deletions: 0, binary: true },
      ],
      repository: {},
      patches: new Map(),
    })).toMatchObject({ fileCount: 2, additions: 2, deletions: 1, metricsResolved: 2, metricsComplete: true })
  })

  test("falls back to directory mode when the git spawn itself fails", async () => {
    // runWorkbenchGit reports exitCode -1 when the process never spawns at all
    // (e.g. git missing from PATH, transient spawn errors) instead of running
    // and exiting. That must degrade to "directory" mode like a missing repo
    // (exit 128) rather than surfacing as an "error" mode.
    const failingProcess = {
      run: () =>
        Effect.succeed({
          command: "git",
          exitCode: -1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("spawn git ENOENT"),
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    } as unknown as AppProcess.Interface
    const layer = Layer.succeed(AppProcess.Service, failingProcess)

    const result = await Effect.runPromise(workbenchMode("C:/does-not-matter").pipe(Effect.provide(layer)))

    expect(result).toEqual({ mode: "directory" })
  })

  changesIt.instance(
    "pages non-Git files without reading contents and honors nested ignore files",
    () => Effect.gen(function* () {
      const page = yield* listWorkbenchChanges({ limit: 2 })
      expect(page.mode).toBe("directory")
      expect(page.items).toHaveLength(2)
      expect(page.next).toBeDefined()
      expect(page.summary.fileCount).toBeGreaterThan(250)
      expect(page.summary).toMatchObject({ metricsResolved: 0, metricsComplete: false })
      expect(page.items.some((item) => item.path === "ignored")).toBe(false)
      const maximum = yield* listWorkbenchChanges({ limit: 200, revision: page.revision })
      expect(maximum.items).toHaveLength(200)
      expect(maximum.next).toBeDefined()
      const tail = yield* listWorkbenchChanges({ limit: 200, cursor: maximum.next, revision: page.revision })
      expect(maximum.items.length + tail.items.length).toBe(page.summary.fileCount)

      const next = yield* listWorkbenchChanges({ limit: 2, cursor: page.next, revision: page.revision })
      expect(next.revision).toBe(page.revision)
      expect(next.items.map((item) => item.path)).not.toEqual(page.items.map((item) => item.path))

      const nested = yield* listWorkbenchChanges({ path: "src", revision: page.revision })
      expect(nested.items.map((item) => item.path)).toContain("src/app.ts")
      expect(nested.items.map((item) => item.path)).not.toContain("src/generated.ts")
      const virtual = yield* listWorkbenchChanges({ path: "missing/folder", revision: page.revision })
      expect(virtual).toMatchObject({ ok: true, items: [] })

      const patch = yield* loadWorkbenchChangePatch({ path: "src/app.ts", revision: page.revision, maxBytes: 1024 })
      expect(patch).toMatchObject({ ok: true, status: "added", additions: 1, deletions: 0, truncated: false })
      expect("patch" in patch ? patch.patch : undefined).toContain("+export const value = 1")
      const oversized = yield* loadWorkbenchChangePatch({ path: "large.txt", revision: page.revision, maxBytes: 1024 })
      expect(oversized).toMatchObject({ ok: true, status: "added", truncated: true })
      expect("patch" in oversized ? oversized.patch : undefined).toBeUndefined()

      const firstMetrics = yield* loadWorkbenchChangeMetrics({ revision: page.revision, limit: 32 })
      expect(firstMetrics).toMatchObject({ ok: true, stale: false, summary: { metricsResolved: 32 } })
      expect("next" in firstMetrics ? firstMetrics.next : undefined).toBeDefined()
      const selectedMetrics = yield* loadWorkbenchChangeMetrics({ revision: page.revision, path: "huge.txt" })
      expect(selectedMetrics).toMatchObject({
        ok: true,
        stale: false,
        items: [{ path: "huge.txt", additions: 4_000, deletions: 0, binary: false }],
        summary: { metricsResolved: 33 },
      })
      expect("next" in selectedMetrics ? selectedMetrics.next : undefined).toBeUndefined()

      const huge = yield* loadWorkbenchChangePatchPage({ path: "huge.txt", revision: page.revision })
      expect(huge).toMatchObject({ ok: true, complete: false, additions: 4_000 })
      const hugeNext = "next" in huge ? huge.next : undefined
      expect(hugeNext).toBeDefined()
      expect(Buffer.byteLength("patch" in huge && huge.patch ? huge.patch : "")).toBeLessThanOrEqual(270 * 1024)
      const continuation = yield* loadWorkbenchChangePatchPage({ path: "huge.txt", revision: page.revision, cursor: hugeNext })
      expect("patch" in continuation ? continuation.patch : undefined).toMatch(/@@ -0,0 \+\d+,\d+ @@/)
    }),
    {
      git: false,
      init: (directory) => Effect.promise(async () => {
        await fs.mkdir(path.join(directory, "ignored"), { recursive: true })
        await fs.mkdir(path.join(directory, "src"), { recursive: true })
        await fs.writeFile(path.join(directory, ".gitignore"), "ignored/\n")
        await fs.writeFile(path.join(directory, "ignored", "large.bin"), "ignored")
        await fs.writeFile(path.join(directory, "src", ".ignore"), "generated.ts\n")
        await fs.writeFile(path.join(directory, "src", "generated.ts"), "generated")
        await fs.writeFile(path.join(directory, "src", "app.ts"), "export const value = 1\n")
        await fs.writeFile(path.join(directory, "a.txt"), "a")
        await fs.writeFile(path.join(directory, "b.txt"), "b")
        await fs.writeFile(path.join(directory, "c.txt"), "c")
        await fs.writeFile(path.join(directory, "large.txt"), "x".repeat(2048))
        await fs.writeFile(path.join(directory, "huge.txt"), Array.from({ length: 4_000 }, (_, index) => `${String(index).padStart(4, "0")}:${"x".repeat(94)}`).join("\n") + "\n")
        await Promise.all(Array.from({ length: 250 }, (_, index) =>
          fs.writeFile(path.join(directory, `bulk-${String(index).padStart(3, "0")}.txt`), "metadata only")))
      }),
    },
  )

  changesIt.instance(
    "returns every changed Git path while loading only the selected patch",
    () => Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => fs.writeFile(path.join(test.directory, "tracked.txt"), "changed\n"))
      yield* Effect.promise(() => fs.mkdir(path.join(test.directory, "untracked"), { recursive: true }))
      yield* Effect.promise(() => Promise.all(Array.from({ length: 100 }, (_, index) =>
        fs.writeFile(path.join(test.directory, "untracked", `${index}.txt`), `${index}\n`))))

      const page = yield* listWorkbenchChanges({ limit: 200 })
      expect(page.mode).toBe("git")
      expect(page.summary.fileCount).toBe(101)
      expect(page.items.every((item) => item.type === "file")).toBe(true)
      expect(page.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "file", path: "tracked.txt" }),
        expect.objectContaining({ type: "file", path: "untracked/99.txt" }),
      ]))

      const metrics = yield* loadWorkbenchChangeMetrics({ revision: page.revision, limit: 32 })
      expect(metrics).toMatchObject({ ok: true, summary: { metricsResolved: 32 } })
      expect(metrics.items.find((item) => item.path === "tracked.txt")).toMatchObject({ additions: 1, deletions: 1, binary: false })

      const patch = yield* loadWorkbenchChangePatch({ path: "tracked.txt", revision: page.revision, maxBytes: 1024 })
      expect(patch).toMatchObject({ ok: true, status: "modified", truncated: false })
      expect("patch" in patch ? patch.patch : undefined).toContain("+changed")
      const patchPage = yield* loadWorkbenchChangePatchPage({ path: "tracked.txt", revision: page.revision })
      expect(patchPage).toMatchObject({ ok: true, complete: true, additions: 1, deletions: 1 })
    }),
    {
      git: true,
      init: (directory) => Effect.promise(async () => {
        await fs.writeFile(path.join(directory, "tracked.txt"), "original\n")
        await mustGit(directory, ["add", "tracked.txt"])
        await mustGit(directory, ["commit", "--no-gpg-sign", "-m", "add tracked"])
      }),
    },
  )

  changesIt.instance(
    "shares a snapshot between concurrent initial manifest requests",
    () => Effect.gen(function* () {
      const [first, second] = yield* Effect.all([
        listWorkbenchChanges({ limit: 1 }),
        listWorkbenchChanges({ limit: 1 }),
      ], { concurrency: 2 })
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(second.revision).toBe(first.revision)

      const refreshed = yield* listWorkbenchChanges({ limit: 1 })
      expect(refreshed.revision).not.toBe(first.revision)
    }),
    { git: true },
  )

  changesIt.instance(
    "loads repository metadata outside the change snapshot",
    () => Effect.gen(function* () {
      const page = yield* listWorkbenchChanges({ limit: 1 })
      expect(page.branch).toBeUndefined()

      const handlers = makeOpencodeXWorkbenchGitHandlers()
      const compatible = yield* handlers.workbenchChanges({ query: {} })
      expect(compatible.branch).toBeString()

      const branches = yield* handlers.workbenchGitBranches()
      expect(branches.ok).toBe(true)
      if (!branches.current) throw new Error("Expected a current branch")
      expect(branches.branches).toContain(branches.current)
    }),
    { git: true },
  )

  changesIt.instance(
    "keeps deletions, unusual paths, binary metrics, and stale revisions scoped",
    () => Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(async () => {
        await fs.rm(path.join(test.directory, "deleted.txt"))
        await fs.writeFile(path.join(test.directory, "binary.bin"), Buffer.from([0, 2, 3]))
        await fs.writeFile(path.join(test.directory, "odd name[1].txt"), "odd\n")
      })

      const page = yield* listWorkbenchChanges({ limit: 200 })
      expect(page.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "deleted.txt", status: "deleted", openable: false }),
        expect.objectContaining({ path: "binary.bin", openable: true }),
        expect.objectContaining({ path: "odd name[1].txt", untracked: true }),
      ]))

      const metrics = yield* loadWorkbenchChangeMetrics({ revision: page.revision })
      expect(metrics.items.find((item) => item.path === "deleted.txt")).toMatchObject({ additions: 0, deletions: 1, binary: false })
      expect(metrics.items.find((item) => item.path === "binary.bin")).toMatchObject({ additions: 0, deletions: 0, binary: true })
      expect(yield* loadWorkbenchChangeMetrics({ revision: "missing" })).toMatchObject({ ok: false, stale: true })

      const deleted = yield* loadWorkbenchChangePatchPage({ path: "deleted.txt", revision: page.revision })
      expect(deleted).toMatchObject({ ok: true, status: "deleted", deletions: 1 })
      expect("patch" in deleted ? deleted.patch : undefined).toContain("-old")
    }),
    {
      git: true,
      init: (directory) => Effect.promise(async () => {
        await fs.writeFile(path.join(directory, "deleted.txt"), "old\n")
        await fs.writeFile(path.join(directory, "binary.bin"), Buffer.from([0, 1, 3]))
        await mustGit(directory, ["add", "."])
        await mustGit(directory, ["commit", "--no-gpg-sign", "-m", "add fixtures"])
      }),
    },
  )

  changesIt.instance(
    "measures staged files on an unborn repository against Git's empty tree",
    () => Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(async () => {
        await mustGit(test.directory, ["init"])
        await fs.writeFile(path.join(test.directory, "first.txt"), "one\ntwo\n")
        await mustGit(test.directory, ["add", "first.txt"])
      })
      const page = yield* listWorkbenchChanges({})
      expect(page.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: "first.txt", status: "added", staged: true })]))
      expect(yield* loadWorkbenchChangeMetrics({ revision: page.revision })).toMatchObject({
        ok: true,
        items: expect.arrayContaining([expect.objectContaining({ path: "first.txt", additions: 2, deletions: 0 })]),
      })
    }),
    { git: false },
  )

  test("loads recent commit history with changed files", async () => {
    const cwd = await tmpdir()
    await mustGit(cwd, ["init"])
    await mustGit(cwd, ["config", "core.fsmonitor", "false"])
    await mustGit(cwd, ["config", "commit.gpgsign", "false"])
    await mustGit(cwd, ["config", "user.email", "test@opencode.test"])
    await mustGit(cwd, ["config", "user.name", "Test"])
    await write(cwd, "README.md", "one\n")
    await mustGit(cwd, ["add", "."])
    await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "initial docs"])
    await write(cwd, "README.md", "two\n")
    await fs.mkdir(path.join(cwd, "src"), { recursive: true })
    await write(cwd, "src/app.ts", "export const value = 1\n")
    await mustGit(cwd, ["add", "."])
    await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "update app"])

    const result = await workbenchGitHistory(cwd, (args, directory) => git(directory, args))

    expect(result.ok).toBe(true)
    expect(result.data[0]).toEqual(expect.objectContaining({
      author: "Test",
      email: "test@opencode.test",
      subject: "update app",
    }))
    expect(Object.prototype.hasOwnProperty.call(result.data[0] ?? {}, "body")).toBe(false)
    expect(result.data[0]?.files.map((file) => file.path).sort()).toEqual(["README.md", "src/app.ts"])
  })

  test("runs configured project diagnostics and parses TypeScript output", async () => {
    const cwd = await tmpdir()
    await write(cwd, "package.json", JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }))
    await write(cwd, "bun.lock", "")

    const result = await workbenchDiagnostics(cwd, async (cmd) => {
      expect(cmd).toEqual(["bun", "run", "typecheck"])
      return {
        code: 2,
        stdout: Buffer.from("src/app.ts(4,12): error TS2322: Type 'string' is not assignable to type 'number'.\n"),
        stderr: Buffer.alloc(0),
      }
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual([{
      path: "src/app.ts",
      line: 4,
      column: 12,
      severity: "error",
      message: "TS2322: Type 'string' is not assignable to type 'number'.",
    }])
  })

  it.instance(
    "discards a tracked worktree change without changing the staged version",
    () =>
      Effect.gen(function* () {
        const cwd = (yield* TestInstance).directory
        yield* Effect.promise(async () => {
          await write(cwd, "tracked[1].txt", "old\n")
          await write(cwd, "tracked1.txt", "old\n")
          await mustGit(cwd, ["add", "."])
          await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "add tracked files"])
          await write(cwd, "tracked[1].txt", "staged\n")
          await mustGit(cwd, ["add", "tracked[1].txt"])
          await write(cwd, "tracked[1].txt", "worktree\n")
          await write(cwd, "tracked1.txt", "other worktree\n")
        })

        const result = yield* makeOpencodeXWorkbenchGitHandlers().workbenchGitDiscard({
          payload: { paths: ["tracked[1].txt"] },
        })

        expect(result.ok).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "tracked[1].txt"), "utf8"))).toBe("staged\n")
        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "tracked1.txt"), "utf8"))).toBe(
          "other worktree\n",
        )
        expect((yield* Effect.promise(() => mustGit(cwd, ["diff", "--cached", "--name-only"]))).text.trim()).toBe(
          "tracked[1].txt",
        )
      }),
    { git: true },
  )

  it.instance(
    "discards only the requested untracked path",
    () =>
      Effect.gen(function* () {
        const cwd = (yield* TestInstance).directory
        yield* Effect.promise(() =>
          Promise.all([write(cwd, "untracked[1].txt", "remove\n"), write(cwd, "untracked1.txt", "keep\n")]),
        )

        const result = yield* makeOpencodeXWorkbenchGitHandlers().workbenchGitDiscard({
          payload: { paths: ["untracked[1].txt"] },
        })

        expect(result.ok).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(path.join(cwd, "untracked[1].txt")).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(path.join(cwd, "untracked1.txt")).exists())).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "discards mixed tracked and untracked paths",
    () =>
      Effect.gen(function* () {
        const cwd = (yield* TestInstance).directory
        yield* Effect.promise(async () => {
          await write(cwd, "tracked.txt", "old\n")
          await mustGit(cwd, ["add", "tracked.txt"])
          await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "add tracked file"])
          await write(cwd, "tracked.txt", "new\n")
          await write(cwd, "untracked.txt", "remove\n")
        })

        const result = yield* makeOpencodeXWorkbenchGitHandlers().workbenchGitDiscard({
          payload: { paths: ["tracked.txt", "untracked.txt"] },
        })

        expect(result.ok).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "tracked.txt"), "utf8"))).toBe("old\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(cwd, "untracked.txt")).exists())).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "stages and unstages a path",
    () =>
      Effect.gen(function* () {
        const cwd = (yield* TestInstance).directory
        const handlers = makeOpencodeXWorkbenchGitHandlers()
        yield* Effect.promise(() => write(cwd, "stage.txt", "content\n"))

        const stage = yield* handlers.workbenchGitStage({ payload: { paths: ["stage.txt"] } })
        expect(stage.ok).toBe(true)
        expect((yield* Effect.promise(() => mustGit(cwd, ["diff", "--cached", "--name-only"]))).text.trim()).toBe(
          "stage.txt",
        )

        const unstage = yield* handlers.workbenchGitUnstage({ payload: { paths: ["stage.txt"] } })
        expect(unstage.ok).toBe(true)
        expect((yield* Effect.promise(() => mustGit(cwd, ["diff", "--cached", "--name-only"]))).text.trim()).toBe("")
        expect(yield* Effect.promise(() => Bun.file(path.join(cwd, "stage.txt")).exists())).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "stages all changes without receiving every path",
    () => Effect.gen(function* () {
      const cwd = (yield* TestInstance).directory
      const handlers = makeOpencodeXWorkbenchGitHandlers()
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(cwd, "nested"), { recursive: true })
        await Promise.all([
          write(cwd, "first.txt", "first\n"),
          write(cwd, "nested/second.txt", "second\n"),
        ])
      })

      expect((yield* handlers.workbenchGitStage({ payload: { all: true } })).ok).toBe(true)
      expect((yield* Effect.promise(() => mustGit(cwd, ["diff", "--cached", "--name-only"]))).text.trim().split(/\r?\n/).sort()).toEqual([
        "first.txt",
        "nested/second.txt",
      ])
    }),
    { git: true },
  )

  it.instance("unstages a path on an unborn branch", () =>
    Effect.gen(function* () {
      const cwd = (yield* TestInstance).directory
      yield* Effect.promise(async () => {
        await mustGit(cwd, ["init"])
        await write(cwd, "first.txt", "content\n")
      })
      const handlers = makeOpencodeXWorkbenchGitHandlers()

      expect((yield* handlers.workbenchGitStage({ payload: { paths: ["first.txt"] } })).ok).toBe(true)
      expect((yield* handlers.workbenchGitUnstage({ payload: { paths: ["first.txt"] } })).ok).toBe(true)
      expect((yield* Effect.promise(() => mustGit(cwd, ["ls-files", "--cached"]))).text.trim()).toBe("")
      expect(yield* Effect.promise(() => Bun.file(path.join(cwd, "first.txt")).exists())).toBe(true)
    }),
  )

  it.instance(
    "commits only selected paths and preserves another staged file",
    () =>
      Effect.gen(function* () {
        const cwd = (yield* TestInstance).directory
        yield* Effect.promise(async () => {
          await write(cwd, "selected[1].txt", "old selected\n")
          await write(cwd, "other.txt", "old other\n")
          await mustGit(cwd, ["add", "."])
          await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "add files"])
          await write(cwd, "selected[1].txt", "new selected\n")
          await write(cwd, "other.txt", "new other\n")
        })
        const handlers = makeOpencodeXWorkbenchGitHandlers()
        expect((yield* handlers.workbenchGitStage({ payload: { paths: ["selected[1].txt", "other.txt"] } })).ok).toBe(
          true,
        )

        const commit = yield* handlers.workbenchGitCommit({
          payload: { message: "selected file", paths: ["selected[1].txt"] },
        })

        expect(commit.ok).toBe(true)
        expect(
          (yield* Effect.promise(() => mustGit(cwd, ["show", "--pretty=", "--name-only", "HEAD"]))).text.trim(),
        ).toBe("selected[1].txt")
        expect((yield* Effect.promise(() => mustGit(cwd, ["show", "HEAD:selected[1].txt"]))).text).toBe(
          "new selected\n",
        )
        expect((yield* Effect.promise(() => mustGit(cwd, ["show", "HEAD:other.txt"]))).text).toBe("old other\n")
        expect((yield* Effect.promise(() => mustGit(cwd, ["diff", "--cached", "--name-only"]))).text.trim()).toBe(
          "other.txt",
        )
      }),
    { git: true },
  )

  it.instance(
    "rejects empty and invalid path payloads consistently",
    () =>
      Effect.gen(function* () {
        const handlers = makeOpencodeXWorkbenchGitHandlers()
        const empty = yield* handlers.workbenchGitStage({ payload: { paths: [] } })
        const invalid = yield* handlers.workbenchGitDiscard({ payload: { paths: ["valid.txt", "../outside.txt"] } })
        const commit = yield* handlers.workbenchGitCommit({ payload: { message: "message", paths: [] } })

        expect(empty).toEqual(expect.objectContaining({ ok: false, reason: "empty" }))
        expect(invalid).toEqual(expect.objectContaining({ ok: false, reason: "empty" }))
        expect(commit).toEqual(expect.objectContaining({ ok: false, reason: "empty" }))
      }),
    { git: true },
  )
})

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-workbench-git-"))
  tmpdirs.push(dir)
  return await fs.realpath(dir)
}

async function write(cwd: string, file: string, content: string) {
  await fs.writeFile(path.join(cwd, file), content, "utf8")
}

async function git(cwd: string, args: string[]) {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [text, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).arrayBuffer(),
    process.exited,
  ])
  return { code, text, stderr: Buffer.from(stderr) }
}

async function mustGit(cwd: string, args: string[]) {
  const result = await git(cwd, args)
  if (result.code === 0) return result
  throw new Error(result.stderr.toString("utf8") || result.text || `git ${args.join(" ")} failed`)
}
