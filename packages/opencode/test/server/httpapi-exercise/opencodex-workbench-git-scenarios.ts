import { Effect } from "effect"
import { rememberWorkbenchSnapshot } from "../../../src/opencodex/workbench-change-snapshot"
import { array, check, isRecord, object } from "./assertions"
import { http } from "./dsl"
import type { Scenario, ScenarioContext } from "./types"

const workbench = "/experimental/opencodex/workbench"

export const opencodexWorkbenchGitScenarios: Scenario[] = [
  http.protected
    .get(`${workbench}/changes/page`, "opencodex.workbench.changes.page")
    .seeded((ctx) => ctx.file("changes-page.txt", "local change\n"))
    .at((ctx) => ({
      path: `${workbench}/changes/page?${new URLSearchParams({ limit: "10" })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.mode === "git", "changes page should use the local Git repository")
      check(hasPath(body.items, "changes-page.txt"), "changes page should include the seeded file")
    }),
  http.protected
    .get(`${workbench}/changes/patch`, "opencodex.workbench.changes.patch")
    .seeded((ctx) => ctx.file("changes-patch.txt", "patch content\n"))
    .at((ctx) => ({
      path: `${workbench}/changes/patch?${new URLSearchParams({ path: "changes-patch.txt", maxBytes: "4096" })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.path === "changes-patch.txt", "change patch should resolve the seeded file")
      check(
        typeof body.patch === "string" && body.patch.includes("+patch content"),
        "change patch should include file content",
      )
    }),
  http.protected
    .get(`${workbench}/changes/metrics/page`, "opencodex.workbench.changes.metricsPage")
    .seeded((ctx) => seedSnapshot(ctx, "changes-metrics.txt", "one\ntwo\n"))
    .at((ctx) => ({
      path: `${workbench}/changes/metrics/page?${new URLSearchParams({ revision: ctx.state.revision, limit: "1" })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.stale === false, "change metrics should use the seeded snapshot")
      check(
        Array.isArray(body.items) &&
          body.items.some((item) => isRecord(item) && item.path === "changes-metrics.txt" && item.additions === 2),
        "change metrics should count the seeded lines",
      )
    }),
  http.protected
    .get(`${workbench}/changes/patch/page`, "opencodex.workbench.changes.patchPage")
    .seeded((ctx) => seedSnapshot(ctx, "changes-patch-page.txt", "paged patch\n"))
    .at((ctx) => ({
      path: `${workbench}/changes/patch/page?${new URLSearchParams({
        path: ctx.state.file,
        revision: ctx.state.revision,
      })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.complete === true, "patch page should complete the small seeded patch")
      check(
        typeof body.patch === "string" && body.patch.includes("+paged patch"),
        "patch page should include file content",
      )
    }),
  http.protected.get(`${workbench}/diagnostics`, "opencodex.workbench.diagnostics").json(200, (body) => {
    object(body)
    check(body.ok === true, "diagnostics should succeed when no project check is configured")
    array(body.diagnostics)
  }),
  http.protected.get(`${workbench}/git/branches`, "opencodex.workbench.git.branches").json(200, (body) => {
    object(body)
    check(body.ok === true && typeof body.current === "string", "branches should report the current branch")
    check(
      Array.isArray(body.branches) && body.branches.includes(body.current),
      "branches should include the current branch",
    )
  }),
  http.protected
    .get(`${workbench}/git/history`, "opencodex.workbench.git.history")
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("history.txt", "history\n")
        yield* git(ctx.directory, ["add", "history.txt"])
        yield* git(ctx.directory, ["commit", "--no-gpg-sign", "-m", "httpapi history"])
      }),
    )
    .json(200, (body) => {
      object(body)
      check(body.ok === true, "history should load from the local repository")
      check(
        Array.isArray(body.data) && body.data.some((item) => isRecord(item) && item.subject === "httpapi history"),
        "history should include the seeded commit",
      )
    }),
  http.protected.get(`${workbench}/git/stashes`, "opencodex.workbench.git.stashes").json(200, (body) => {
    object(body)
    check(body.ok === true, "stashes should load from the local repository")
    check(Array.isArray(body.data) && body.data.length === 0, "new local repository should have no stashes")
  }),
  http.protected
    .post(`${workbench}/git/checkout`, "opencodex.workbench.git.checkout")
    .mutating()
    .seeded((ctx) => git(ctx.directory, ["branch", "httpapi-checkout"]))
    .at((ctx) => ({
      path: `${workbench}/git/checkout`,
      headers: ctx.headers(),
      body: { branch: "httpapi-checkout" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "checkout should succeed")
        check(
          (yield* git(ctx.directory, ["branch", "--show-current"])).trim() === "httpapi-checkout",
          "checkout should switch branches",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/create-branch`, "opencodex.workbench.git.create_branch")
    .mutating()
    .at((ctx) => ({
      path: `${workbench}/git/create-branch`,
      headers: ctx.headers(),
      body: { branch: "httpapi-created" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "create branch should succeed")
        check(
          (yield* git(ctx.directory, ["branch", "--show-current"])).trim() === "httpapi-created",
          "created branch should be current",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/stage`, "opencodex.workbench.git.stage")
    .mutating()
    .seeded((ctx) => ctx.file("stage.txt", "stage\n"))
    .at((ctx) => ({
      path: `${workbench}/git/stage`,
      headers: ctx.headers(),
      body: { paths: ["stage.txt"] },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "stage should succeed")
        check(
          (yield* git(ctx.directory, ["diff", "--cached", "--name-only"])).trim() === "stage.txt",
          "stage should update the index",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/unstage`, "opencodex.workbench.git.unstage")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("unstage.txt", "unstage\n")
        yield* git(ctx.directory, ["add", "unstage.txt"])
      }),
    )
    .at((ctx) => ({
      path: `${workbench}/git/unstage`,
      headers: ctx.headers(),
      body: { paths: ["unstage.txt"] },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "unstage should succeed")
        check(
          (yield* git(ctx.directory, ["diff", "--cached", "--name-only"])).trim() === "",
          "unstage should clear the index entry",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/discard`, "opencodex.workbench.git.discard")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("discard.txt", "before\n")
        yield* git(ctx.directory, ["add", "discard.txt"])
        yield* git(ctx.directory, ["commit", "--no-gpg-sign", "-m", "httpapi discard fixture"])
        yield* ctx.file("discard.txt", "after\n")
      }),
    )
    .at((ctx) => ({
      path: `${workbench}/git/discard`,
      headers: ctx.headers(),
      body: { paths: ["discard.txt"] },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "discard should succeed")
        check(
          (yield* Effect.promise(() => Bun.file(`${directory(ctx.directory)}/discard.txt`).text())) === "before\n",
          "discard should restore the tracked file",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/commit`, "opencodex.workbench.git.commit")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("commit.txt", "commit\n")
        yield* git(ctx.directory, ["add", "commit.txt"])
      }),
    )
    .at((ctx) => ({
      path: `${workbench}/git/commit`,
      headers: ctx.headers(),
      body: { message: "httpapi commit" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "commit should succeed")
        check(
          (yield* git(ctx.directory, ["log", "-1", "--format=%s"])).trim() === "httpapi commit",
          "commit should create the requested revision",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/fetch`, "opencodex.workbench.git.fetch")
    .mutating()
    .json(200, (body) => operation(body, true, "fetch without remotes should be a local no-op")),
  http.protected
    .post(`${workbench}/git/pull`, "opencodex.workbench.git.pull")
    .mutating()
    .json(200, (body) => operation(body, false, "pull without an upstream should report failure")),
  http.protected
    .post(`${workbench}/git/push`, "opencodex.workbench.git.push")
    .mutating()
    .json(200, (body) => operation(body, false, "push without a remote should report failure")),
  http.protected
    .post(`${workbench}/git/publish`, "opencodex.workbench.git.publish")
    .mutating()
    .json(200, (body) => operation(body, false, "publish without an origin should report failure")),
  http.protected
    .post(`${workbench}/git/stash`, "opencodex.workbench.git.stash")
    .mutating()
    .seeded((ctx) => ctx.file("stash-create.txt", "stash create\n"))
    .at((ctx) => ({
      path: `${workbench}/git/stash`,
      headers: ctx.headers(),
      body: { message: "httpapi stash create" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "stash create should succeed")
        check(
          (yield* git(ctx.directory, ["stash", "list"])).includes("httpapi stash create"),
          "stash create should add a stash",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/stash/apply`, "opencodex.workbench.git.stash_apply")
    .mutating()
    .seeded((ctx) => seedStash(ctx, "stash-apply.txt", "httpapi stash apply"))
    .at((ctx) => ({
      path: `${workbench}/git/stash/apply`,
      headers: ctx.headers(),
      body: { ref: "stash@{0}" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "stash apply should succeed")
        check(
          yield* Effect.promise(() => Bun.file(`${directory(ctx.directory)}/${ctx.state.file}`).exists()),
          "stash apply should restore the file",
        )
        check(
          (yield* git(ctx.directory, ["stash", "list"])).includes("httpapi stash apply"),
          "stash apply should retain the stash",
        )
      }),
    ),
  http.protected
    .post(`${workbench}/git/stash/pop`, "opencodex.workbench.git.stash_pop")
    .mutating()
    .seeded((ctx) => seedStash(ctx, "stash-pop.txt", "httpapi stash pop"))
    .at((ctx) => ({
      path: `${workbench}/git/stash/pop`,
      headers: ctx.headers(),
      body: { ref: "stash@{0}" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "stash pop should succeed")
        check(
          yield* Effect.promise(() => Bun.file(`${directory(ctx.directory)}/${ctx.state.file}`).exists()),
          "stash pop should restore the file",
        )
        check((yield* git(ctx.directory, ["stash", "list"])).trim() === "", "stash pop should remove the stash")
      }),
    ),
  http.protected
    .post(`${workbench}/git/stash/drop`, "opencodex.workbench.git.stash_drop")
    .mutating()
    .seeded((ctx) => seedStash(ctx, "stash-drop.txt", "httpapi stash drop"))
    .at((ctx) => ({
      path: `${workbench}/git/stash/drop`,
      headers: ctx.headers(),
      body: { ref: "stash@{0}" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        operation(body, true, "stash drop should succeed")
        check((yield* git(ctx.directory, ["stash", "list"])).trim() === "", "stash drop should remove the stash")
      }),
    ),
  http.protected
    .get(`${workbench}/github/auth`, "opencodex.workbench.github.auth")
    .json(200, (body) => noGithubRemote(body, "GitHub auth")),
  http.protected
    .get(`${workbench}/github/repo`, "opencodex.workbench.github.repo")
    .json(200, (body) => noGithubRemote(body, "GitHub repository")),
  http.protected
    .get(`${workbench}/github/issues`, "opencodex.workbench.github.issues")
    .json(200, (body) => noGithubRemote(body, "GitHub issues")),
  http.protected
    .get(`${workbench}/github/pulls`, "opencodex.workbench.github.pulls")
    .json(200, (body) => noGithubRemote(body, "GitHub pulls")),
  http.protected
    .post(`${workbench}/github/pull`, "opencodex.workbench.github.pull")
    .at((ctx) => ({
      path: `${workbench}/github/pull`,
      headers: ctx.headers(),
      body: { number: "offline" },
    }))
    .status(400),
  http.protected
    .post(`${workbench}/github/checks`, "opencodex.workbench.github.checks")
    .at((ctx) => ({
      path: `${workbench}/github/checks`,
      headers: ctx.headers(),
      body: { number: "offline" },
    }))
    .status(400),
  http.protected
    .post(`${workbench}/github/checkout-pull`, "opencodex.workbench.github.checkout_pull")
    .mutating()
    .at((ctx) => ({
      path: `${workbench}/github/checkout-pull`,
      headers: ctx.headers(),
      body: { number: 1 },
    }))
    .json(200, (body) => {
      operation(body, false, "checkout pull without an origin should report failure")
      object(body)
      check(body.reason === "no_github_remote", "checkout pull should stop before fetching without a GitHub origin")
    }),
  http.protected
    .post(`${workbench}/github/create-pull`, "opencodex.workbench.github.create_pull")
    .at((ctx) => ({
      path: `${workbench}/github/create-pull`,
      headers: ctx.headers(),
      body: { title: "HTTP API pull request" },
    }))
    .json(200, (body) => noGithubRemote(body, "create pull")),
]

function seedSnapshot(ctx: ScenarioContext, file: string, content: string) {
  return Effect.gen(function* () {
    yield* ctx.file(file, content)
    const revision = `httpapi-${crypto.randomUUID()}`
    rememberWorkbenchSnapshot({
      directory: directory(ctx.directory),
      revision,
      createdAt: Date.now(),
      mode: "git",
      files: [
        {
          type: "file",
          name: file,
          path: file,
          status: "added",
          staged: false,
          unstaged: true,
          untracked: true,
          openable: true,
        },
      ],
      repository: {},
      patches: new Map(),
    })
    return { revision, file }
  })
}

function seedStash(ctx: ScenarioContext, file: string, message: string) {
  return Effect.gen(function* () {
    yield* ctx.file(file, `${message}\n`)
    yield* git(ctx.directory, ["stash", "push", "--include-untracked", "-m", message])
    return { file }
  })
}

function git(cwd: string | undefined, args: string[]) {
  return Effect.promise(async () => {
    const child = Bun.spawn(["git", ...args], {
      cwd: directory(cwd),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr || stdout || `git ${args.join(" ")} failed`)
    return stdout
  })
}

function directory(value: string | undefined) {
  if (!value) throw new Error("workbench Git scenario needs a project directory")
  return value
}

function operation(body: unknown, ok: boolean, label: string) {
  object(body)
  check(body.ok === ok, `${label}: ${JSON.stringify(body)}`)
}

function noGithubRemote(body: unknown, label: string) {
  operation(body, false, `${label} should report the missing remote`)
  object(body)
  check(
    typeof body.message === "string" && /GitHub origin|GitHub repository data/.test(body.message),
    `${label} should explain that no GitHub origin exists`,
  )
}

function hasPath(value: unknown, expected: string) {
  return Array.isArray(value) && value.some((item) => isRecord(item) && item.path === expected)
}
