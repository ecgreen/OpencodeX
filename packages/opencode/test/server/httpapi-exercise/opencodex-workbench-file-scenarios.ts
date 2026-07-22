import { Effect } from "effect"
import path from "path"
import { array, check, isRecord, object } from "./assertions"
import { http } from "./dsl"
import type { Scenario } from "./types"

export const opencodexWorkbenchFileScenarios: Scenario[] = [
  http.protected
    .get("/experimental/opencodex/workbench/file/read", "opencodex.workbench.file.read")
    .seeded((ctx) => ctx.file("httpapi-workbench-read.txt", "read exactly\n"))
    .at((ctx) => ({
      path: `/experimental/opencodex/workbench/file/read?${new URLSearchParams({ path: "httpapi-workbench-read.txt" })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true, "workbench file read should succeed")
      check(body.content === "read exactly\n", "workbench file read should return exact file contents")
    }),
  http.protected
    .post("/experimental/opencodex/workbench/file/create", "opencodex.workbench.file.create")
    .mutating()
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/create",
      headers: ctx.headers(),
      body: { path: "httpapi-workbench-created.txt", content: "created\n" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(body.ok === true, "workbench file create should succeed")
        check(body.message === "Created.", "workbench file create should report creation")
        const content = yield* Effect.promise(() =>
          Bun.file(path.join(ctx.directory ?? "", "httpapi-workbench-created.txt")).text(),
        )
        check(content === "created\n", "workbench file create should write the requested content")
      }),
    ),
  http.protected
    .post("/experimental/opencodex/workbench/file/write", "opencodex.workbench.file.write")
    .mutating()
    .seeded((ctx) => ctx.file("httpapi-workbench-write.txt", "before\n"))
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/write",
      headers: ctx.headers(),
      body: {
        path: "httpapi-workbench-write.txt",
        content: "after\n",
        previousContent: "before\n",
      },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(body.ok === true, "workbench file write should succeed")
        check(body.message === "Saved.", "workbench file write should report saving")
        const content = yield* Effect.promise(() =>
          Bun.file(path.join(ctx.directory ?? "", "httpapi-workbench-write.txt")).text(),
        )
        check(content === "after\n", "workbench file write should replace the file contents")
      }),
    ),
  http.protected
    .post("/experimental/opencodex/workbench/file/rename", "opencodex.workbench.file.rename")
    .mutating()
    .seeded((ctx) => ctx.file("httpapi-workbench-rename-before.txt", "rename me\n"))
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/rename",
      headers: ctx.headers(),
      body: {
        from: "httpapi-workbench-rename-before.txt",
        to: "httpapi-workbench-rename-after.txt",
      },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(body.ok === true, "workbench file rename should succeed")
        check(body.message === "Renamed.", "workbench file rename should report success")
        const before = Bun.file(path.join(ctx.directory ?? "", "httpapi-workbench-rename-before.txt"))
        const after = Bun.file(path.join(ctx.directory ?? "", "httpapi-workbench-rename-after.txt"))
        check(!(yield* Effect.promise(() => before.exists())), "workbench file rename should remove the source path")
        check(
          (yield* Effect.promise(() => after.text())) === "rename me\n",
          "workbench file rename should preserve content",
        )
      }),
    ),
  http.protected
    .post("/experimental/opencodex/workbench/file/delete", "opencodex.workbench.file.delete")
    .mutating()
    .seeded((ctx) => ctx.file("httpapi-workbench-delete.txt", "delete me\n"))
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/delete",
      headers: ctx.headers(),
      body: { path: "httpapi-workbench-delete.txt" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(body.ok === true, "workbench file delete should succeed")
        check(body.message === "Deleted.", "workbench file delete should report success")
        const exists = yield* Effect.promise(() =>
          Bun.file(path.join(ctx.directory ?? "", "httpapi-workbench-delete.txt")).exists(),
        )
        check(!exists, "workbench file delete should remove the file")
      }),
    ),
  http.protected
    .post("/experimental/opencodex/workbench/file/diagnostics", "opencodex.workbench.file.diagnostics")
    .seeded((ctx) => ctx.file("httpapi-workbench-diagnostics.no-lsp", "unsaved diagnostics text\n"))
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/diagnostics",
      headers: ctx.headers(),
      body: {
        path: "httpapi-workbench-diagnostics.no-lsp",
        content: "changed diagnostics text\n",
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true, "workbench file diagnostics should return a successful response")
      check(body.supported === false, "unknown file types should report diagnostics as unsupported")
      array(body.diagnostics)
      check(body.diagnostics.length === 0, "unsupported diagnostics should return no diagnostics")
    }),
  http.protected
    .post("/experimental/opencodex/workbench/file/definition", "opencodex.workbench.file.definition")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const content = "import { helper } from './httpapi-workbench-definition-helper'\n"
        yield* ctx.file("httpapi-workbench-definition.no-lsp", content)
        yield* ctx.file("httpapi-workbench-definition-helper.ts", "export const helper = true\n")
        return content
      }),
    )
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/definition",
      headers: ctx.headers(),
      body: {
        path: "httpapi-workbench-definition.no-lsp",
        content: ctx.state,
        line: 1,
        column: 28,
      },
    }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "relative import definition should resolve one target")
      object(body[0])
      check(
        body[0].path === "httpapi-workbench-definition-helper.ts",
        "relative import definition should resolve the isolated helper",
      )
      check(
        body[0].line === 1 && body[0].column === 1 && body[0].endLine === 1 && body[0].endColumn === 1,
        "relative import definition should return the fallback file position",
      )
    }),
  http.protected
    .post("/experimental/opencodex/workbench/file/hover", "opencodex.workbench.file.hover")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const content = "import { helper } from './httpapi-workbench-hover-helper'\n"
        yield* ctx.file("httpapi-workbench-hover.no-lsp", content)
        yield* ctx.file("httpapi-workbench-hover-helper.ts", "export const helper = true\n")
        return content
      }),
    )
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/hover",
      headers: ctx.headers(),
      body: {
        path: "httpapi-workbench-hover.no-lsp",
        content: ctx.state,
        line: 1,
        column: 28,
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.supported === true, "relative import hover should use the built-in fallback")
      array(body.contents)
      check(
        body.contents.some(
          (item) => isRecord(item) && item.kind === "code" && item.value === "./httpapi-workbench-hover-helper",
        ),
        "relative import hover should describe the imported module",
      )
      array(body.definitions)
      check(
        body.definitions.some(
          (item) => isRecord(item) && item.path === "httpapi-workbench-hover-helper.ts" && item.line === 1,
        ),
        "relative import hover should include the isolated helper definition",
      )
      object(body.range)
      check(body.range.line === 1 && body.range.column === 25, "relative import hover should identify the import range")
    }),
  http.protected
    .post("/experimental/opencodex/workbench/file/completion", "opencodex.workbench.file.completion")
    .seeded((ctx) => ctx.file("httpapi-workbench-completion.no-lsp", "complete this\n"))
    .at((ctx) => ({
      path: "/experimental/opencodex/workbench/file/completion",
      headers: ctx.headers(),
      body: {
        path: "httpapi-workbench-completion.no-lsp",
        content: "complete this\n",
        line: 1,
        column: 9,
        triggerKind: 1,
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.supported === false, "unknown file types should report completion as unsupported")
      array(body.items)
      check(body.items.length === 0, "unsupported completion should return no items")
    }),
]
