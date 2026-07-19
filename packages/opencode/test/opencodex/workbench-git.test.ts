import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { workbenchDiagnostics } from "../../src/opencodex/workbench-diagnostics"
import { workbenchGitDiffFiles, workbenchGitHistory } from "../../src/opencodex/workbench-git"
import { makeOpencodeXWorkbenchGitHandlers } from "../../src/server/routes/instance/httpapi/handlers/opencodex-workbench-git-handlers"
import { TestInstance } from "../fixture/fixture"
import { it } from "../lib/effect"

const tmpdirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpdirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("OpencodeX Workbench Git", () => {
  test("collects staged, unstaged, and untracked diffs from one worktree", async () => {
    const cwd = await tmpdir()
    await mustGit(cwd, ["init"])
    await mustGit(cwd, ["config", "core.fsmonitor", "false"])
    await mustGit(cwd, ["config", "commit.gpgsign", "false"])
    await mustGit(cwd, ["config", "user.email", "test@opencode.test"])
    await mustGit(cwd, ["config", "user.name", "Test"])
    await write(cwd, "unstaged.txt", "old\n")
    await write(cwd, "staged.txt", "old\n")
    await mustGit(cwd, ["add", "."])
    await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "add files"])
    await write(cwd, "unstaged.txt", "new\n")
    await write(cwd, "staged.txt", "new\n")
    await mustGit(cwd, ["add", "staged.txt"])
    await write(cwd, "untracked.txt", "one\ntwo\n")

    const result = await workbenchGitDiffFiles(cwd, (args, directory) => git(directory, args))

    expect(result.ok).toBe(true)
    expect(result.data.map((file) => file.file)).toEqual(["staged.txt", "unstaged.txt", "untracked.txt"])
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "staged.txt", status: "modified", additions: 1, deletions: 1 }),
        expect.objectContaining({ file: "unstaged.txt", status: "modified", additions: 1, deletions: 1 }),
        expect.objectContaining({ file: "untracked.txt", status: "added", additions: 2, deletions: 0 }),
      ]),
    )
    expect(result.data.find((file) => file.file === "staged.txt")?.patch).toContain("+new")
    expect(result.data.find((file) => file.file === "unstaged.txt")?.patch).toContain("-old")
    expect(result.data.find((file) => file.file === "untracked.txt")?.patch).toContain("+two")
  })

  test("returns paths relative to a nested workbench directory", async () => {
    const cwd = await tmpdir()
    const workspace = path.join(cwd, "packages", "gui")
    await fs.mkdir(workspace, { recursive: true })
    await mustGit(cwd, ["init"])
    await mustGit(cwd, ["config", "core.fsmonitor", "false"])
    await mustGit(cwd, ["config", "commit.gpgsign", "false"])
    await mustGit(cwd, ["config", "user.email", "test@opencode.test"])
    await mustGit(cwd, ["config", "user.name", "Test"])
    await write(cwd, "packages/gui/style.css", "body { color: black; }\n")
    await mustGit(cwd, ["add", "."])
    await mustGit(cwd, ["commit", "--no-gpg-sign", "-m", "add nested file"])
    await write(cwd, "packages/gui/style.css", "body { color: white; }\n")
    await write(cwd, "packages/gui/new.ts", "export const value = 1\n")

    const result = await workbenchGitDiffFiles(workspace, (args, directory) => git(directory, args))

    expect(result.ok).toBe(true)
    expect(result.data.map((file) => file.file)).toEqual(["new.ts", "style.css"])
    expect(result.data.find((file) => file.file === "style.css")?.patch).toContain("diff --git a/style.css b/style.css")
    expect(result.data.find((file) => file.file === "new.ts")?.patch).toContain("diff --git a/new.ts b/new.ts")
  })

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
