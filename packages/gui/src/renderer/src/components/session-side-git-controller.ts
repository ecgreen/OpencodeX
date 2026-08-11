import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { batch, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  initializeWorkbenchGit,
  workbenchChangeMetricsPage,
  type WorkbenchChangeFile,
  type WorkbenchChangesPage,
} from "../lib/session-api"
import {
  displayWorkbenchChangeSummary,
  emptyWorkbenchChangeSummary,
  isWorkbenchAbort,
  mergeWorkbenchFileMetrics,
  normalizeWorkbenchDirectory,
  normalizeWorkbenchPath,
  reconcileWorkbenchFiles,
  type WorkbenchChangeSummary,
} from "./session-side-git-model"
import { loadWorkbenchManifest } from "./session-side-git-manifest"
import { createWorkbenchPatchController } from "./session-side-git-patch-controller"
import { createSelectedWorkbenchMetricsController } from "./session-side-git-selected-metrics"
import { createWorkbenchRepositoryController } from "./session-side-git-repository"

const METRIC_PAGE_SIZE = 32
const REFRESH_MS = 30_000
const WATCHER_DEBOUNCE_MS = 250
const SLOW_LOADING_MS = 2_000
export const SIDE_PANEL_GIT_VISIBLE_RECHECK_MS = 6_000

export function createSessionSideGitController(input: {
  active: Accessor<boolean>
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  subscribeGlobalEvents?: (listener: (event: GlobalEvent) => void | Promise<void>) => () => void
}) {
  const [files, setFiles] = createSignal<readonly WorkbenchChangeFile[]>([])
  const [summary, setSummary] = createSignal(emptyWorkbenchChangeSummary())
  const [mode, setMode] = createSignal<"git" | "directory">("git")
  const [revision, setRevision] = createSignal("")
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")
  const [refreshError, setRefreshError] = createSignal("")
  const [metricsError, setMetricsError] = createSignal("")
  const [ready, setReady] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [manifestComplete, setManifestComplete] = createSignal(false)
  const [manifestLoaded, setManifestLoaded] = createSignal(0)
  const [manifestTotal, setManifestTotal] = createSignal(0)
  const [slowLoading, setSlowLoading] = createSignal(false)
  const [initializing, setInitializing] = createSignal(false)
  const [initializationError, setInitializationError] = createSignal("")
  const repository = createWorkbenchRepositoryController({ gui: input.gui, directory: input.directory })
  const selectedMetrics = createSelectedWorkbenchMetricsController({
    gui: input.gui, directory: input.directory, revision, files, setFiles, setSummary,
    setError: setMetricsError, refresh: () => void refresh(),
  })
  const patch = createWorkbenchPatchController({
    gui: input.gui,
    directory: input.directory,
    revision,
    measure: (path, currentRevision) => void selectedMetrics.measure(path, currentRevision),
    refresh: () => void refresh(),
    applyMetrics: (path, additions, deletions, binary) => {
      const nextFiles = mergeWorkbenchFileMetrics(files(), [{ path, additions, deletions, binary }])
      setFiles(nextFiles)
      setSummary((current) => displayWorkbenchChangeSummary(current, nextFiles))
    },
  })
  let manifestRequest: AbortController | undefined
  let metricsRequest: AbortController | undefined
  let initializationRequest: AbortController | undefined
  let watcherTimer: ReturnType<typeof setTimeout> | undefined
  let slowLoadingTimer: ReturnType<typeof setTimeout> | undefined
  let refreshPromise: Promise<void> | undefined
  let refreshGeneration = -1
  let refreshQueued = false
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
    refreshQueued = false
    clearWatcherTimer()
    abortRequests()
  })

  createEffect(() => {
    if (!input.subscribeGlobalEvents) return
    const unsubscribe = input.subscribeGlobalEvents((event) => {
      if (!input.active() || event.payload.type !== "file.watcher.updated") return
      if (normalizeWorkbenchDirectory(event.directory) !== normalizeWorkbenchDirectory(input.directory())) return
      clearWatcherTimer()
      const currentGeneration = generation
      watcherTimer = globalThis.setTimeout(() => {
        watcherTimer = undefined
        if (!input.active() || currentGeneration !== generation) return
        void refresh()
      }, WATCHER_DEBOUNCE_MS)
    })
    onCleanup(unsubscribe)
  })

  onCleanup(() => {
    abortRequests()
    initializationRequest?.abort()
    clearWatcherTimer()
    clearSlowLoadingTimer()
  })

  function refresh() {
    const currentGeneration = generation
    if (refreshPromise && refreshGeneration === currentGeneration) {
      refreshQueued = true
      return refreshPromise
    }
    refreshGeneration = currentGeneration
    const current = refreshLoop(currentGeneration)
    refreshPromise = current
    void current.finally(() => {
      if (refreshPromise === current) refreshPromise = undefined
    })
    return current
  }

  async function refreshLoop(currentGeneration: number) {
    do {
      refreshQueued = false
      await runRefresh()
      // oxlint-disable-next-line no-unmodified-loop-condition -- `generation` is bumped by
      // resetWorkspace() during the `await runRefresh()` above; the rule can't see that
      // cross-closure mutation, so this is a false positive.
    } while (refreshQueued && currentGeneration === generation && input.active())
  }

  async function runRefresh() {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    const hadReady = ready()
    const currentGeneration = generation
    const sequence = ++refreshSequence
    manifestRequest?.abort()
    metricsRequest?.abort()
    const controller = new AbortController()
    manifestRequest = controller
    if (hadReady) setRefreshing(true)
    else {
      setLoading(true)
      setSlowLoading(false)
      clearSlowLoadingTimer()
      slowLoadingTimer = globalThis.setTimeout(() => {
        if (sequence === refreshSequence && currentGeneration === generation && !ready()) setSlowLoading(true)
      }, SLOW_LOADING_MS)
    }
    setRefreshError("")
    setMetricsError("")
    try {
      const current = () => !controller.signal.aborted && sequence === refreshSequence && currentGeneration === generation && directory === input.directory()
      const manifest = await loadWorkbenchManifest({
        gui, directory, controller, current,
        ...(!hadReady ? { first: (page: WorkbenchChangesPage) => page.mode === "git" ? void repository.load(page.revision) : repository.reset() } : {}),
        ...(!hadReady ? { publish: (page, staged) => publishManifest(page, staged, false) } : {}),
      })
      if (!manifest) return
      if (hadReady) manifest.first.mode === "git" ? void repository.load(manifest.first.revision) : repository.reset()
      publishManifest(manifest.first, manifest.files, true)
      loadedAt = Date.now()
      void measure(manifest.first.revision, sequence, currentGeneration)
    } catch (cause) {
      if (isWorkbenchAbort(cause)) return
      const value = cause instanceof Error ? cause.message : "Unable to load project changes."
      if (ready()) setRefreshError(value)
      else setError(value)
    } finally {
      if (manifestRequest === controller) manifestRequest = undefined
      if (sequence === refreshSequence && currentGeneration === generation) {
        clearSlowLoadingTimer()
        setSlowLoading(false)
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  function publishManifest(first: WorkbenchChangesPage, staged: WorkbenchChangeFile[], complete: boolean) {
    const nextFiles = reconcileWorkbenchFiles(files(), staged)
    batch(() => {
      setFiles(nextFiles)
      setSummary(displayWorkbenchChangeSummary(first.summary, nextFiles))
      setMode(first.mode)
      setRevision(first.revision)
      setMessage(first.message ?? "")
      setError("")
      setRefreshError("")
      setManifestLoaded(staged.length)
      setManifestTotal(first.summary.fileCount)
      setManifestComplete(complete)
      setReady(true)
    })
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

  function refreshIfStale() {
    if (!ready() || loading() || refreshing()) return
    if (Date.now() - loadedAt < REFRESH_MS) return
    void refresh()
  }

  function resetWorkspace() {
    generation++
    refreshSequence++
    refreshQueued = false
    loadedAt = 0
    clearWatcherTimer()
    clearSlowLoadingTimer()
    abortRequests()
    initializationRequest?.abort()
    initializationRequest = undefined
    batch(() => {
      setFiles([])
      setSummary(emptyWorkbenchChangeSummary())
      setMode("git")
      setRevision("")
      repository.reset()
      setMessage("")
      setError("")
      setRefreshError("")
      setMetricsError("")
      setReady(false)
      setLoading(false)
      setRefreshing(false)
      setManifestComplete(false)
      setManifestLoaded(0)
      setManifestTotal(0)
      setSlowLoading(false)
      setInitializing(false)
      setInitializationError("")
      patch.reset()
    })
  }

  function abortRequests() {
    manifestRequest?.abort()
    metricsRequest?.abort()
    selectedMetrics.abort()
    repository.abort()
    patch.abort()
    manifestRequest = undefined
    metricsRequest = undefined
  }

  function clearWatcherTimer() {
    if (watcherTimer === undefined) return
    globalThis.clearTimeout(watcherTimer)
    watcherTimer = undefined
  }

  function clearSlowLoadingTimer() {
    if (slowLoadingTimer === undefined) return
    globalThis.clearTimeout(slowLoadingTimer)
    slowLoadingTimer = undefined
  }

  return {
    files,
    summary,
    mode,
    revision,
    branch: repository.branch,
    repository: repository.repository,
    message,
    error,
    refreshError,
    metricsError,
    ready,
    loading,
    refreshing,
    manifestComplete,
    manifestLoaded,
    manifestTotal,
    slowLoading,
    available: () => Boolean(input.gui() && input.directory()),
    initializing,
    initializationError,
    patchLoading: patch.loading,
    initializeRepository,
    loadPatch: patch.load,
    reveal,
    patch: patch.patch,
    refresh,
    refreshIfStale,
  }
}

export type SessionSideGitController = ReturnType<typeof createSessionSideGitController>

export { reconcileWorkbenchFiles, sidePanelChangeForPath } from "./session-side-git-model"
export type { WorkbenchPatchModel } from "./session-side-git-model"
