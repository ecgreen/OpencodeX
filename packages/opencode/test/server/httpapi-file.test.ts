import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import fs from "fs/promises"
import { File } from "../../src/file"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test("serves bounded file content metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "boundary.txt"), "éé")

    const [boundary, truncated, invalid] = await Promise.all([
      request(FilePaths.content, tmp.path, { path: "boundary.txt", maxBytes: "4" }),
      request(FilePaths.content, tmp.path, { path: "boundary.txt", maxBytes: "3" }),
      request(FilePaths.content, tmp.path, {
        path: "boundary.txt",
        maxBytes: String(File.MAX_CONTENT_BYTES + 1),
      }),
    ])

    expect(boundary.status).toBe(200)
    expect(await boundary.json()).toEqual({ type: "text", content: "éé", bytes: 4, truncated: false })
    expect(truncated.status).toBe(200)
    expect(await truncated.json()).toEqual({ type: "text", content: "", bytes: 4, truncated: true })
    expect(invalid.status).toBe(400)
  })

  test("bounds exact workbench reads", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "exact.txt"), "hello\n")

    const [content, truncated] = await Promise.all([
      request("/experimental/opencodex/workbench/file/read", tmp.path, { path: "exact.txt", maxBytes: "6" }),
      request("/experimental/opencodex/workbench/file/read", tmp.path, { path: "exact.txt", maxBytes: "5" }),
    ])

    expect(content.status).toBe(200)
    expect(await content.json()).toEqual({ ok: true, content: "hello\n", bytes: 6, truncated: false })
    expect(truncated.status).toBe(200)
    expect(await truncated.json()).toEqual({ ok: true, bytes: 6, truncated: true })
  })

  test("serves flat non-Git changes, progressive metrics, and selected patch pages", async () => {
    await using tmp = await tmpdir({ git: false })
    await Bun.write(path.join(tmp.path, ".gitignore"), "ignored/\n")
    await Bun.write(path.join(tmp.path, "first.txt"), "one\ntwo\n")
    await Bun.write(path.join(tmp.path, "second.txt"), "second\n")
    await fs.mkdir(path.join(tmp.path, "ignored"), { recursive: true })
    await Bun.write(path.join(tmp.path, "ignored", "large.txt"), "ignored")

    const first = await request("/experimental/opencodex/workbench/changes/page", tmp.path, { limit: "1" })
    expect(first.status).toBe(200)
    const page = await first.json() as { mode: string; revision: string; next?: string; items: Array<{ path: string; openable: boolean }>; summary: { fileCount: number } }
    expect(page.mode).toBe("directory")
    expect(page.summary.fileCount).toBeGreaterThanOrEqual(3)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.path).not.toBe("ignored")
    expect(page.items[0]?.openable).toBe(true)
    expect(page.next).toBeDefined()

    const virtual = await request("/experimental/opencodex/workbench/changes/page", tmp.path, {
      path: "does/not/exist",
      revision: page.revision,
    })
    expect(virtual.status).toBe(200)
    expect(await virtual.json()).toMatchObject({ ok: true, items: [] })

    const metrics = await request("/experimental/opencodex/workbench/changes/metrics/page", tmp.path, {
      revision: page.revision,
      limit: "2",
    })
    expect(metrics.status).toBe(200)
    expect(await metrics.json()).toMatchObject({ ok: true, summary: { metricsResolved: 2, metricsTotal: page.summary.fileCount } })

    const patchPage = await request("/experimental/opencodex/workbench/changes/patch/page", tmp.path, {
      path: "first.txt",
      revision: page.revision,
    })
    expect(patchPage.status).toBe(200)
    expect(await patchPage.json()).toMatchObject({ ok: true, complete: true, additions: 2, deletions: 0 })

    const patch = await request("/experimental/opencodex/workbench/changes/patch", tmp.path, {
      path: "first.txt",
      revision: page.revision,
      maxBytes: "1024",
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toMatchObject({
      ok: true,
      path: "first.txt",
      revision: page.revision,
      status: "added",
      additions: 2,
      deletions: 0,
      binary: false,
      truncated: false,
    })
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})
