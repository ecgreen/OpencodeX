import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { batch, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  initializeWorkbenchGit,
  workbenchChangeMetricsPage,
  workbenchChangePatchPage,
  workbenchChanges,
  type WorkbenchChangeFile,
} from "../lib/session-api"
import {
  displayWorkbenchChangeSummary,
  emptyWorkbenchChangeSummary,
  emptyWorkbenchPatch,
  isWorkbenchAbort,
  mergeWorkbenchFileMetrics,
  normalizeWorkbenchDirectory,
  normalizeWorkbenchPath,
  reconcileWorkbenchFiles,
  workbenchPatchForPath,
  workbenchPatchKey,
  type WorkbenchChangeSummary,
  type WorkbenchPatchModel,
} from "./session-side-git-model"
import { createSelectedWorkbenchMetricsController } from "./session-side-git-selected-metrics"

const MANIFEST_PAGE_SIZE = 200
const METRIC_PAGE_SIZE = 32
const REFRESH_MS = 30_000
const WATCHER_DEBOUNCE_MS = 250
export const SIDE_PANEL_GIT_VISIBLE_RECHECK_MS = 6_000

export function createSessionSideGitController(input: {
  active: Accessor<boolean>
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  subscribeGlobalEvents?: (listener: (event: GlobalEvent) => void | Promise<void>) => () => void
}) {
  const [files, setFiles] = createSignal<readonly WorkbenchChangeFile[]>([])
  const [summary, setSummary] = createSignal<WorkbenchChangeSummary>(emptyWorkbenchChangeSummary())
  const [mode, setMode] = createSignal<"git" | "directory">("git")
  const [revision, setRevision] = createSignal("")
  const [branch, setBranch] = createSignal("")
  const [repository, setRepository] = createSignal<{
    defaultBranch?: string
    upstream?: string
    ahead?: number
    behind?: number
    remoteUrl?: string
    githubUrl?: string
  }>({})
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")
  const [refreshError, setRefreshError] = createSignal("")
  const [metricsError, setMetricsError] = createSignal("")
  const [ready, setReady] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [initializing, setInitializing] = createSignal(false)
  const [initializationError, setInitializationError] = createSignal("")
  const [patchEntries, setPatchEntries] = createSignal<readonly (readonly [string, WorkbenchPatchModel])[]>([])
  const [patchLoading, setPatchLoading] = createSignal("")
  const patches = createMemo(() => new Map(patchEntries()))
  const selectedMetrics = createSelectedWorkbenchMetricsController({
    gui: input.gui, directory: input.directory, revision, files, setFiles, setSummary,
    setError: setMetricsError, refresh: () => void refresh(),
  })
  let manifestRequest: AbortController | undefined
  let metricsRequest: AbortController | undefined
  let patchRequest: AbortController | undefined
  let initializationRequest: AbortController | undefined
  let watcherTimer: ReturnType<typeof setTimeout> | undefined
  let workspaceKey = ""
  let generation = 0
  let refreshSequence = 0
  let loadedAt = 0

  createEffect(() => {
    const next = `${input.gui()?.url ?? ""}\n${input.directory()}`
    if (workspaceKey === next) return
    workspaceKey = next
    resetWorkspace()
  })

  createEffect(() => {
    if (!input.active() || !input.gui() || !input.directory() || ready() || loading()) return
    void refresh()
  })

  createEffect(() => {
    if (input.active()) return
    abortRequests()
  })

  createEffect(() => {
    if (!input.subscribeGlobalEvents) return
    const unsubscribe = input.subscribeGlobalEvents((event) => {
      if (!input.active() || event.payload.type !== "file.watcher.updated") return
      if (normalizeWorkbenchDirectory(event.directory) !== normalizeWorkbenchDirectory(input.directory())) return
      if (watcherTimer !== undefined) globalThis.clearTimeout(watcherTimer)
      watcherTimer = globalThis.setTimeout(() => void refresh(), WATCHER_DEBOUNCE_MS)
    })
    onCleanup(unsubscribe)
  })

  onCleanup(() => {
    abortRequests()
    initializationRequest?.abort()
    if (watcherTimer !== undefined) globalThis.clearTimeout(watcherTimer)
  })

  async function refresh() {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    const currentGeneration = generation
    const sequence = ++refreshSequence
    manifestRequest?.abort()
    metricsRequest?.abort()
    const controller = new AbortController()
    manifestRequest = controller
    if (ready()) setRefreshing(true)
    else setLoading(true)
    setRefreshError("")
    setMetricsError("")
    try {
      const staged: WorkbenchChangeFile[] = []
      const first = await workbenchChanges(gui, {
        directory,
        limit: MANIFEST_PAGE_SIZE,
        signal: controller.signal,
      })
      if (!first.ok) throw new Error(first.message ?? "Unable to load project changes.")
      staged.push(...first.items)
      let cursor = first.next
      while (cursor) {
        const page = await workbenchChanges(gui, {
          directory,
          cursor,
          revision: first.revision,
          limit: MANIFEST_PAGE_SIZE,
          signal: controller.signal,
        })
        if (!page.ok || page.revision !== first.revision) throw new Error(page.message ?? "The change snapshot became stale.")
        staged.push(...page.items)
        cursor = page.next
      }
      if (controller.signal.aborted || sequence !== refreshSequence || currentGeneration !== generation || directory !== input.directory()) return
      const nextFiles = reconcileWorkbenchFiles(files(), staged)
      batch(() => {
        setFiles(nextFiles)
        setSummary(displayWorkbenchChangeSummary(first.summary, nextFiles))
        setMode(first.mode)
        setRevision(first.revision)
        setBranch(first.branch ?? "")
        setRepository({
          defaultBranch: first.defaultBranch,
          upstream: first.upstream,
          ahead: first.ahead,
          behind: first.behind,
          remoteUrl: first.remoteUrl,
          githubUrl: first.githubUrl,
        })
        setMessage(first.message ?? "")
        setError("")
        setRefreshError("")
        setReady(true)
      })
      loadedAt = Date.now()
      void measure(first.revision, sequence, currentGeneration)
    } catch (cause) {
      if (isWorkbenchAbort(cause)) return
      const value = cause instanceof Error ? cause.message : "Unable to load project changes."
      if (ready()) setRefreshError(value)
      else setError(value)
    } finally {
      if (manifestRequest === controller) manifestRequest = undefined
      if (sequence === refreshSequence && currentGeneration === generation) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  async function measure(currentRevision: string, sequence: number, currentGeneration: number) {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    metricsRequest?.abort()
    const controller = new AbortController()
    metricsRequest = controller
    try {
      let cursor: string | undefined
      do {
        const page = await workbenchChangeMetricsPage(gui, {
          directory,
          revision: currentRevision,
          cursor,
          limit: METRIC_PAGE_SIZE,
          signal: controller.signal,
        })
        if (controller.signal.aborted || sequence !== refreshSequence || currentGeneration !== generation || currentRevision !== revision()) return
        if (!page.ok) {
          if (page.stale) void refresh()
          else setMetricsError(page.message ?? "Line metrics are paused.")
          return
        }
        const nextFiles = mergeWorkbenchFileMetrics(files(), page.items)
        batch(() => {
          setFiles(nextFiles)
          setSummary(displayWorkbenchChangeSummary(page.summary, nextFiles))
          setMetricsError("")
        })
        cursor = page.next
      } while (cursor)
    } catch (cause) {
      if (!isWorkbenchAbort(cause) && currentRevision === revision())
        setMetricsError(cause instanceof Error ? cause.message : "Line metrics are paused.")
    } finally {
      if (metricsRequest === controller) metricsRequest = undefined
    }
  }

  async function loadPatch(path: string) {
    const gui = input.gui()
    const directory = input.directory()
    const currentRevision = revision()
    const key = workbenchPatchKey(currentRevision, path)
    if (!gui || !directory || !currentRevision || patches().get(key)?.complete || patchLoading() === path) return
    void selectedMetrics.measure(path, currentRevision)
    patchRequest?.abort()
    const controller = new AbortController()
    patchRequest = controller
    setPatchLoading(path)
    try {
      let cursor: string | undefined
      let model = patches().get(key) ?? emptyWorkbenchPatch(path, currentRevision)
      do {
        const page = await workbenchChangePatchPage(gui, {
          directory,
          path,
          revision: currentRevision,
          cursor,
          context: 8,
          signal: controller.signal,
        })
        if (controller.signal.aborted || currentRevision !== revision() || directory !== input.directory()) return
        if (!page.ok) {
          model = { ...model, ...page, pages: model.pages, complete: true }
          setPatchEntries([[key, model]])
          if (page.stale) void refresh()
          return
        }
        model = {
          ...model,
          ...page,
          pages: page.patch ? [...model.pages, page.patch] : model.pages,
        }
        setPatchEntries([[key, model]])
        cursor = page.next
      } while (cursor)
      if (model.additions !== undefined && model.deletions !== undefined) {
        const nextFiles = mergeWorkbenchFileMetrics(files(), [{
          path, additions: model.additions, deletions: model.deletions, binary: model.binary,
        }])
        setFiles(nextFiles)
        setSummary((current) => displayWorkbenchChangeSummary(current, nextFiles))
      }
    } catch (cause) {
      if (isWorkbenchAbort(cause)) return
      setPatchEntries([[key, {
        ...emptyWorkbenchPatch(path, currentRevision),
        message: cause instanceof Error ? cause.message : "Unable to load file patch.",
        complete: true,
      }]])
    } finally {
      if (patchRequest === controller) patchRequest = undefined
      if (patchLoading() === path) setPatchLoading("")
    }
  }

  async function initializeRepository() {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory || initializing()) return
    const currentGeneration = generation
    initializationRequest?.abort()
    const controller = new AbortController()
    initializationRequest = controller
    setInitializing(true)
    setInitializationError("")
    try {
      await initializeWorkbenchGit(gui, directory, controller.signal)
      if (controller.signal.aborted || currentGeneration !== generation || directory !== input.directory()) return
      await refresh()
    } catch (cause) {
      if (!isWorkbenchAbort(cause) && currentGeneration === generation && directory === input.directory())
        setInitializationError(cause instanceof Error ? cause.message : "Could not initialize this repository.")
    } finally {
      if (initializationRequest === controller) initializationRequest = undefined
      if (currentGeneration === generation && directory === input.directory()) setInitializing(false)
    }
  }

  function reveal(path: string) {
    const parts = normalizeWorkbenchPath(path).split("/").filter(Boolean)
    return Promise.resolve(parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/")))
  }

  function patch(path: string) {
    return workbenchPatchForPath(patchEntries(), revision(), path)
  }

  function refreshIfStale() {
    if (!ready() || loading() || refreshing()) return
    if (Date.now() - loadedAt < REFRESH_MS) return
    void refresh()
  }

  function resetWorkspace() {
    generation++
    refreshSequence++
    loadedAt = 0
    abortRequests()
    initializationRequest?.abort()
    initializationRequest = undefined
    batch(() => {
      setFiles([])
      setSummary(emptyWorkbenchChangeSummary())
      setMode("git")
      setRevision("")
      setBranch("")
      setRepository({})
      setMessage("")
      setError("")
      setRefreshError("")
      setMetricsError("")
      setReady(false)
      setLoading(false)
      setRefreshing(false)
      setInitializing(false)
      setInitializationError("")
      setPatchEntries([])
      setPatchLoading("")
    })
  }

  function abortRequests() {
    manifestRequest?.abort()
    metricsRequest?.abort()
    selectedMetrics.abort()
    patchRequest?.abort()
    manifestRequest = undefined
    metricsRequest = undefined
    patchRequest = undefined
    setPatchLoading("")
  }

  return {
    files,
    summary,
    mode,
    revision,
    branch,
    repository,
    message,
    error,
    refreshError,
    metricsError,
    ready,
    loading,
    refreshing,
    initializing,
    initializationError,
    patchLoading,
    initializeRepository,
    loadPatch,
    reveal,
    patch,
    refresh,
    refreshIfStale,
  }
}

export type SessionSideGitController = ReturnType<typeof createSessionSideGitController>

export { reconcileWorkbenchFiles, sidePanelChangeForPath } from "./session-side-git-model"
export type { WorkbenchPatchModel } from "./session-side-git-model"
