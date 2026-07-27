import { describe, expect, test } from "bun:test"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree, moveDiffSelection, nextDiffFile } from "../../src/renderer/src/lib/diff-file-tree"
import { installPlugin, listPlugins, togglePlugin, type DiffFile, type GuiPlugin } from "../../src/renderer/src/lib/store"
import { defaultTranscriptExportOptions, normalizeTranscriptFilename, prepareSessionTranscriptExport } from "../../src/renderer/src/lib/transcript-export"
import { assistantMessage, gui, provider, session } from "./fixtures"

describe("GUI functional diff, plugin, and export workflows", () => {
  test("navigates a nested diff tree and cycles changed files", () => {
    const files: DiffFile[] = [
      { file: "src/app.tsx", additions: 10, deletions: 2 },
      { file: "src/lib/store.ts", additions: 3, deletions: 1 },
      { file: "README.md", additions: 1, deletions: 0 },
    ] as DiffFile[]
    const tree = buildDiffFileTree(files)
    const rows = flattenDiffFileTree(tree, expandedDirectories(tree))

    expect(rows.map((row) => `${row.type}:${row.path}`)).toEqual([
      "directory:src",
      "directory:src/lib",
      "file:src/lib/store.ts",
      "file:src/app.tsx",
      "file:README.md",
    ])
    expect(moveDiffSelection(rows, "dir:src", 1)).toBe("dir:src/lib")
    expect(nextDiffFile(files, "src/lib/store.ts", 1)).toBe("README.md")
    expect(nextDiffFile(files, "README.md", 1)).toBe("src/app.tsx")
  })

  test("lists, installs, and toggles plugins through sidecar API endpoints", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("/install")) {
        return Response.json({ ok: true, tui: true, server: false, items: [] })
      }
      if (String(url).includes("/toggle")) {
        return Response.json(plugin({ enabled: false, active: false }))
      }
      return Response.json([plugin()])
    }) as typeof fetch

    try {
      const client = { ...gui(), url: "http://127.0.0.1:4099", authHeader: "Basic test" }

      expect(await listPlugins(client)).toEqual([plugin()])
      expect(await installPlugin(client, { spec: "local-plugin", global: true })).toMatchObject({ ok: true, tui: true })
      expect(await togglePlugin(client, { id: "plugin-1", enabled: false })).toMatchObject({ id: "plugin-1", enabled: false, active: false })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/experimental/opencodex/plugin",
      "/experimental/opencodex/plugin/install",
      "/experimental/opencodex/plugin/toggle",
    ])
    expect(calls.every((call) => new URL(call.url).searchParams.get("directory") === "C:/Work/OpencodeX")).toBe(true)
    expect(calls.map((call) => call.init?.headers)).toEqual([
      { authorization: "Basic test" },
      { "content-type": "application/json", authorization: "Basic test" },
      { "content-type": "application/json", authorization: "Basic test" },
    ])
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ spec: "local-plugin", global: true }))
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ id: "plugin-1", enabled: false }))
  })

  test("surfaces plugin sidecar failures with response text or status fallback", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("/install")) {
        return new Response("invalid plugin spec", { status: 400 })
      }
      return new Response("", { status: 503 })
    }) as typeof fetch

    try {
      const client = { ...gui(), url: "http://127.0.0.1:4099", authHeader: "Basic test" }

      await expect(installPlugin(client, { spec: "missing-plugin", force: true })).rejects.toThrow("invalid plugin spec")
      await expect(togglePlugin(client, { id: "plugin-1", enabled: true })).rejects.toThrow("Plugin request failed with 503")
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/experimental/opencodex/plugin/install",
      "/experimental/opencodex/plugin/toggle",
    ])
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ spec: "missing-plugin", force: true }))
    expect(calls[1]?.init?.method).toBe("PATCH")
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ id: "plugin-1", enabled: true }))
  })

  test("exports transcript markdown with TUI-style option controls", () => {
    const options = {
      ...defaultTranscriptExportOptions({
        session: session("session-1"),
        thinking: true,
        toolDetails: true,
        assistantMetadata: true,
      }),
      filename: "Session Export",
      thinking: false,
      toolDetails: false,
      assistantMetadata: false,
      openWithoutSaving: true,
    }
    const result = prepareSessionTranscriptExport({
      session: session("session-1", { title: "Release notes" }),
      messages: [assistantMessage({ reasoning: "hidden", tool: true })],
      providers: [provider()],
      options,
    })

    expect(result.filename).toBe("Session Export.md")
    expect(result.openWithoutSaving).toBe(true)
    expect(result.markdown).toContain("# Release notes")
    expect(result.markdown).toContain("## Assistant\n")
    expect(result.markdown).not.toContain("hidden")
    expect(result.markdown).not.toContain("**Input:**")
    expect(normalizeTranscriptFilename("bad:path*", session("session-1"))).toBe("bad-path-.md")
  })
})

function plugin(input: Partial<GuiPlugin> = {}): GuiPlugin {
  return {
    id: "plugin-1",
    pluginID: "plugin-1",
    kind: "tui",
    spec: "local-plugin",
    source: "C:/Work/OpencodeX/plugin",
    scope: "local",
    enabled: true,
    active: true,
    canToggle: true,
    ...input,
  }
}
