import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionSideGitController, reconcileWorkbenchFiles, sidePanelChangeForPath } from "../src/renderer/src/components/session-side-git-controller"
import { mergeWorkbenchFileMetrics, workbenchPatchForPath, type WorkbenchPatchModel } from "../src/renderer/src/components/session-side-git-model"
import type { GuiClient } from "../src/renderer/src/lib/client"

describe("session side Git results", () => {
  test("matches a selected change across absolute and relative paths", () => {
    const files = [{ type: "file" as const, name: "app.ts", path: "src/app.ts", status: "modified" as const, staged: false, unstaged: true, untracked: false, openable: true }]
    expect(sidePanelChangeForPath(files, "C:/repo/src/app.ts")?.path).toBe("src/app.ts")
    expect(sidePanelChangeForPath(files, "src/other.ts")).toBeUndefined()
  })

  test("stages flat pages atomically, measures progressively, and appends only the selected patch", async () => {
    const pages: Array<{ path?: string; revision?: string; cursor?: string; signal?: AbortSignal }> = []
    const metrics: Array<{ revision: string; cursor?: string; signal?: AbortSignal }> = []
    const patches: Array<{ path: string; cursor?: string; signal?: AbortSignal }> = []
    const [active, setActive] = createSignal(true)
    let revision = 0
    let currentRevision = ""
    let slowRefresh = false
    let globalListener: ((event: { directory: string; payload: { type: string } }) => void) | undefined
    const gui = {
      url: "http://127.0.0.1:4096",
      directory: "C:/repo",
      authHeader: "",
      client: {
        opencodex: {
          workbench: {
            changes: {
              page: async (input: { path?: string; revision?: string; cursor?: string }, options: { signal?: AbortSignal }) => {
                pages.push({ ...input, signal: options.signal })
                if (slowRefresh && !input.revision) return abortable(options.signal)
                if (!input.revision) currentRevision = `rev-${++revision}`
                const value = input.revision ?? currentRevision
                const summary = { fileCount: 2, additions: 0, deletions: 0, metricsResolved: 0, metricsTotal: 2, metricsComplete: false }
                return { data: {
                  ok: true,
                  mode: "directory",
                  revision: value,
                  path: "",
                  items: input.cursor
                    ? [{ type: "file", name: "store.ts", path: "src/lib/store.ts", status: "added", staged: false, unstaged: false, untracked: true, openable: true }]
                    : [{ type: "file", name: "app.ts", path: "src/app.ts", status: "added", staged: false, unstaged: false, untracked: true, openable: true }],
                  summary,
                  ...(input.cursor ? {} : { next: "manifest-2" }),
                } }
              },
              metricsPage: async (input: { revision: string; cursor?: string }, options: { signal?: AbortSignal }) => {
                metrics.push({ ...input, signal: options.signal })
                return { data: {
                  ok: true,
                  stale: false,
                  revision: input.revision,
                  items: [
                    { path: "src/app.ts", additions: 1, deletions: 0, binary: false },
                    { path: "src/lib/store.ts", additions: 2, deletions: 0, binary: false },
                  ],
                  summary: { fileCount: 2, additions: 3, deletions: 0, metricsResolved: 2, metricsTotal: 2, metricsComplete: true },
                } }
              },
              patchPage: async (input: { path: string; revision: string; cursor?: string }, options: { signal?: AbortSignal }) => {
                patches.push({ path: input.path, cursor: input.cursor, signal: options.signal })
                return { data: {
                  ok: true,
                  stale: false,
                  path: input.path,
                  revision: input.revision,
                  status: "added",
                  patch: input.cursor ? "@@ -20 +20 @@\n-old\n+new" : "@@ -1 +1 @@\n-old\n+new",
                  additions: 1,
                  deletions: 0,
                  binary: false,
                  complete: Boolean(input.cursor),
                  ...(input.cursor ? {} : { next: "patch-2" }),
                } }
              },
            },
          },
        },
      },
    } as unknown as GuiClient
    let dispose = () => undefined
    const controller = createRoot((cleanup) => {
      dispose = cleanup
      return createSessionSideGitController({
        active,
        gui: () => gui,
        directory: () => gui.directory,
        subscribeGlobalEvents: (listener) => {
          globalListener = listener as typeof globalListener
          return () => { globalListener = undefined }
        },
      })
    })

    try {
      controller.refreshIfStale()
      await waitFor(() => controller.ready() && controller.summary().metricsComplete)
      expect(pages).toHaveLength(2)
      expect(controller.files().map((file) => file.path)).toEqual(["src/app.ts", "src/lib/store.ts"])
      expect(controller.summary()).toMatchObject({ fileCount: 2, additions: 3, metricsResolved: 2 })
      expect(pages.every((page) => page.path === undefined)).toBe(true)
      expect(patches).toHaveLength(0)
      await controller.loadPatch("src/app.ts")
      await controller.loadPatch("src/app.ts")
      expect(patches).toHaveLength(2)
      expect(controller.patch("src/app.ts")?.pages).toHaveLength(2)
      expect(metrics).toHaveLength(1)

      const app = controller.files()[0]
      const visiblePatch = controller.patch("src/app.ts")
      const initialRevision = controller.revision()
      globalListener?.({ directory: gui.directory, payload: { type: "file.watcher.updated" } })
      await waitFor(() => controller.revision() !== initialRevision)
      expect(controller.files()[0]).toBe(app)
      expect(controller.patch("src/app.ts")).toBe(visiblePatch)

      slowRefresh = true
      void controller.refresh()
      await waitFor(() => controller.refreshing())
      expect(controller.ready()).toBe(true)
      expect(controller.files()).toHaveLength(2)
      setActive(false)
      await waitFor(() => pages.at(-1)?.signal?.aborted === true)
    } finally {
      dispose()
    }
  })

  test("reconciles unchanged rows by path while replacing changed metadata", () => {
    const current = [file("same.ts"), file("changed.ts")]
    const next = reconcileWorkbenchFiles(current, [file("same.ts"), { ...file("changed.ts"), status: "deleted", openable: false }])
    expect(next[0]).toBe(current[0])
    expect(next[1]).not.toBe(current[1])
  })

  test("replaces measured files and preserves the previous patch while a new revision loads", () => {
    const files = [file("measured.ts"), file("untouched.ts")]
    const measured = mergeWorkbenchFileMetrics(files, [
      { path: "measured.ts", additions: 2, deletions: 0, binary: false },
    ])
    const previous = patch("measured.ts", "rev-1")
    const current = patch("measured.ts", "rev-2")

    expect(measured[0]).not.toBe(files[0])
    expect(measured[0]).toMatchObject({ additions: 2, deletions: 0, binary: false })
    expect(measured[1]).toBe(files[1])
    expect(workbenchPatchForPath([["rev-1\nmeasured.ts", previous]], "rev-2", "measured.ts")).toBe(previous)
    expect(workbenchPatchForPath([
      ["rev-1\nmeasured.ts", previous],
      ["rev-2\nmeasured.ts", current],
    ], "rev-2", "measured.ts")).toBe(current)
  })

  test("measures a selected file without waiting for its patch or the background sweep", async () => {
    const metrics: Array<{ path?: string; signal?: AbortSignal }> = []
    const gui = {
      url: "http://127.0.0.1:4096",
      directory: "C:/repo",
      authHeader: "",
      client: {
        opencodex: {
          workbench: {
            changes: {
              page: async () => ({ data: {
                ok: true,
                mode: "git",
                revision: "rev-1",
                path: "",
                items: [file("large.ts")],
                summary: { fileCount: 1, additions: 0, deletions: 0, metricsResolved: 0, metricsTotal: 1, metricsComplete: false },
              } }),
              metricsPage: async (input: { path?: string }, options: { signal?: AbortSignal }) => {
                metrics.push({ path: input.path, signal: options.signal })
                if (!input.path) return abortable(options.signal)
                return { data: {
                  ok: true,
                  stale: false,
                  revision: "rev-1",
                  items: [{ path: input.path, additions: 250, deletions: 12, binary: false }],
                  summary: { fileCount: 1, additions: 250, deletions: 12, metricsResolved: 1, metricsTotal: 1, metricsComplete: true },
                } }
              },
              patchPage: async (_input: unknown, options: { signal?: AbortSignal }) => abortable(options.signal),
            },
          },
        },
      },
    } as unknown as GuiClient
    let dispose = () => undefined
    const controller = createRoot((cleanup) => {
      dispose = cleanup
      return createSessionSideGitController({ active: () => false, gui: () => gui, directory: () => gui.directory })
    })

    try {
      await controller.refresh()
      void controller.loadPatch("large.ts")
      await waitFor(() => controller.files()[0]?.additions === 250)

      expect(metrics.map((request) => request.path)).toEqual([undefined, "large.ts"])
      expect(controller.files()[0]).toMatchObject({ additions: 250, deletions: 12, binary: false })
      expect(controller.summary()).toMatchObject({ additions: 250, deletions: 12, metricsResolved: 1, metricsComplete: true })
      expect(controller.patch("large.ts")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("initializes a non-Git workspace through the project API", async () => {
    const calls: Array<{ directory?: string; signal?: AbortSignal }> = []
    const gui = {
      url: "http://127.0.0.1:4096",
      directory: "C:/repo",
      authHeader: "",
      client: {
        project: {
          initGit: async (input: { directory?: string }, options: { signal?: AbortSignal }) => {
            calls.push({ directory: input.directory, signal: options.signal })
            return { data: { id: "project", vcs: "git" } }
          },
        },
      },
    } as unknown as GuiClient
    const controller = createRoot(() => createSessionSideGitController({
      active: () => false,
      gui: () => gui,
      directory: () => gui.directory,
    }))

    await controller.initializeRepository()

    expect(calls).toEqual([{ directory: "C:/repo", signal: expect.any(AbortSignal) }])
    expect(controller.initializationError()).toBe("")
  })
})

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 250 })) {
    if (predicate()) return
    await Bun.sleep(2)
  }
  throw new Error("Timed out waiting for Git controller state")
}

function file(path: string) {
  return { type: "file" as const, name: path, path, status: "added" as const, staged: false, unstaged: false, untracked: true, openable: true }
}

function patch(path: string, revision: string): WorkbenchPatchModel {
  return { ok: true, stale: false, path, revision, status: "modified", pages: [revision], binary: false, complete: true }
}

function abortable(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
}
