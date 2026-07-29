import type {
  Event,
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  ClientStateSyncController,
  ClientSessionDetailState,
  ClientStateSyncLifecycle,
  ClientStateSyncState,
  ClientCatalogProject,
  OpencodeXJob,
  OpencodeXSwarm,
  ClientCatalogView,
  OpencodeXSessionUiState,
} from "@opencode-ai/sdk/v2"
import { createClientStateSync, loadClientSessionTranscript, normalizeClientDisplayPart } from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/core/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { batch, createEffect, onCleanup, onMount } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { useKV } from "./kv"
import { aggregateFailures } from "./aggregate-failures"
import {
  changedTuiSessionDetails,
  collectTuiLiveDetailChanges,
  projectTuiClientState,
  type TuiLiveDetailChange,
  tuiClientStateChanges,
} from "./sync-state"
import {
  EMPTY_TUI_TRANSCRIPT_WINDOW,
  TUI_SESSION_PAGE_LIMIT,
  TUI_SESSION_RELEASE_DELAY_MS,
  TUI_SESSION_TAIL_LIMIT,
  TUI_SESSION_TRANSCRIPT_PAGE_LIMIT,
  sameTuiTranscriptWindow,
  tuiTranscriptAfterOlderPage,
  tuiTranscriptFromTail,
  tuiTranscriptTrim,
  tuiWarmSessions,
  tuiWarmSessionsWithout,
  type TuiTranscriptWindow,
} from "./sync-transcript"

const PENDING_PROMPT_IDLE_RELEASE_MS = 500

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      state_sync: ClientStateSyncLifecycle
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      opencodex_project: ClientCatalogProject[]
      opencodex_job: OpencodeXJob[]
      opencodex_swarm: OpencodeXSwarm[]
      opencodex_view: ClientCatalogView[]
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_ui_state: {
        [sessionID: string]: OpencodeXSessionUiState
      }
      session_pending_prompt: {
        [sessionID: string]: string | undefined
      }
      session_transcript: {
        [sessionID: string]: TuiTranscriptWindow
      }
      session_sync_revision: string | undefined
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      state_sync: { status: "idle", data: "empty", attempt: 0 },
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      opencodex_project: [],
      opencodex_job: [],
      opencodex_swarm: [],
      opencodex_view: [],
      session: [],
      session_status: {},
      session_ui_state: {},
      session_pending_prompt: {},
      session_transcript: {},
      session_sync_revision: undefined,
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const kv = useKV()

    // Retention: a session's transcript stays resident while something on screen
    // holds a retainer, then for a grace period after, then only while it is one
    // of the few most recently visited. Everything else is dropped from both the
    // TUI store and the SDK's canonical state.
    const retainedSessions = new Map<string, number>()
    const hydratedSessions = new Set<string>()
    const sessionReleaseTimers = new Map<string, Timer>()
    let warmSessions: string[] = []
    const appliedSessionVersions = new Map<string, string>()
    let stateSync: ClientStateSyncController | undefined
    let stateSyncStart: Promise<void> | undefined
    let unsubscribeStateSync: (() => void) | undefined
    let stateSyncScope = ""
    let appliedStateSync: ClientStateSyncState | undefined
    let liveDetailChanges: Map<string, TuiLiveDetailChange> | undefined
    const pendingPromptReleaseTimers = new Map<string, Timer>()

    function clearProjectedState() {
      hydratedSessions.clear()
      sessionReleaseTimers.forEach(clearTimeout)
      sessionReleaseTimers.clear()
      warmSessions = []
      appliedSessionVersions.clear()
      appliedStateSync = undefined
      batch(() => {
        setStore("provider", reconcile([]))
        setStore("provider_default", reconcile({}))
        setStore("provider_next", reconcile({ all: [], default: {}, connected: [] }))
        setStore("provider_auth", reconcile({}))
        setStore("agent", reconcile([]))
        setStore("command", reconcile([]))
        setStore("permission", reconcile({}))
        setStore("question", reconcile({}))
        setStore("config", reconcile({}))
        setStore("opencodex_project", reconcile([]))
        setStore("opencodex_job", reconcile([]))
        setStore("opencodex_swarm", reconcile([]))
        setStore("opencodex_view", reconcile([]))
        setStore("session", reconcile([]))
        setStore("session_status", reconcile({}))
        setStore("session_ui_state", reconcile({}))
        setStore("session_sync_revision", undefined)
        setStore("session_diff", reconcile({}))
        setStore("session_transcript", reconcile({}))
        setStore("todo", reconcile({}))
        setStore("message", reconcile({}))
        setStore("part", reconcile({}))
        setStore("lsp", reconcile([]))
        setStore("mcp", reconcile({}))
        setStore("mcp_resource", reconcile({}))
        setStore("formatter", reconcile([]))
      })
    }

    function pruneSessionDetails(keep: ReadonlySet<string>) {
      removeSessionDetails(
        new Set(
          [
            ...Object.keys(store.message),
            ...Object.keys(store.todo),
            ...Object.keys(store.session_diff),
            ...Object.keys(store.session_transcript),
          ].filter((sessionID) => !keep.has(sessionID)),
        ),
      )
    }

    function removeSessionDetails(removed: ReadonlySet<string>) {
      if (removed.size === 0) return
      const messageIDs = new Set(
        [...removed].flatMap((sessionID) => (store.message[sessionID] ?? []).map((item) => item.id)),
      )
      setStore(
        "message",
        produce((draft) => removed.forEach((sessionID) => delete draft[sessionID])),
      )
      setStore(
        "todo",
        produce((draft) => removed.forEach((sessionID) => delete draft[sessionID])),
      )
      setStore(
        "session_diff",
        produce((draft) => removed.forEach((sessionID) => delete draft[sessionID])),
      )
      setStore(
        "session_pending_prompt",
        produce((draft) => removed.forEach((sessionID) => delete draft[sessionID])),
      )
      setStore(
        "session_transcript",
        produce((draft) => removed.forEach((sessionID) => delete draft[sessionID])),
      )
      setStore(
        "part",
        produce((draft) => messageIDs.forEach((messageID) => delete draft[messageID])),
      )
      removed.forEach((sessionID) => {
        clearTimeout(pendingPromptReleaseTimers.get(sessionID))
        pendingPromptReleaseTimers.delete(sessionID)
        hydratedSessions.delete(sessionID)
        appliedSessionVersions.delete(sessionID)
        // A session that is gone must not keep a warm slot; still-retained ones
        // simply have not hydrated yet, so they stay.
        if (!retainedSessions.has(sessionID)) warmSessions = tuiWarmSessionsWithout(warmSessions, sessionID)
      })
    }

    /**
     * Refcounted retainer. Every screen that renders a session's transcript
     * holds one for as long as it is mounted; the returned dispose releases it.
     */
    function retainSession(sessionID: string) {
      retainedSessions.set(sessionID, (retainedSessions.get(sessionID) ?? 0) + 1)
      clearTimeout(sessionReleaseTimers.get(sessionID))
      sessionReleaseTimers.delete(sessionID)
      const promoted = tuiWarmSessions(warmSessions, sessionID)
      warmSessions = promoted.warm
      promoted.evicted.forEach(scheduleSessionRelease)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        const count = (retainedSessions.get(sessionID) ?? 1) - 1
        if (count > 0) {
          retainedSessions.set(sessionID, count)
          return
        }
        retainedSessions.delete(sessionID)
        scheduleSessionRelease(sessionID)
      }
    }

    function scheduleSessionRelease(sessionID: string) {
      if (retainedSessions.has(sessionID) || sessionReleaseTimers.has(sessionID)) return
      const timer = setTimeout(() => {
        sessionReleaseTimers.delete(sessionID)
        releaseSessionState(sessionID)
      }, TUI_SESSION_RELEASE_DELAY_MS)
      timer.unref?.()
      sessionReleaseTimers.set(sessionID, timer)
    }

    function releaseSessionState(sessionID: string) {
      if (retainedSessions.has(sessionID) || warmSessions.includes(sessionID)) return
      stateSync?.releaseSession(sessionID)
      batch(() => removeSessionDetails(new Set([sessionID])))
    }

    /**
     * Applies the render cap and publishes the resulting window. Returns the
     * message IDs the transcript should actually mount.
     */
    function transcriptWindowIDs(sessionID: string, detail: ClientSessionDetailState) {
      const current = store.session_transcript[sessionID] ?? EMPTY_TUI_TRANSCRIPT_WINDOW
      const trimmed = tuiTranscriptTrim(detail.messageIDs, (messageID) => detail.messages[messageID], current)
      // Copy: `trimmed.window` can be the shared default, and the store takes
      // ownership of whatever object it is given.
      if (!sameTuiTranscriptWindow(store.session_transcript[sessionID], trimmed.window))
        setStore("session_transcript", sessionID, reconcile({ ...trimmed.window }))
      // A message ID the detail has no message for is unrenderable. Dropping it
      // here keeps the window aligned with the projected store array, which the
      // incremental update path indexes into.
      return trimmed.ids.every((messageID) => detail.messages[messageID])
        ? trimmed.ids
        : trimmed.ids.filter((messageID) => detail.messages[messageID])
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", false)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function applyStateSync(state: ClientStateSyncState, forceProjection = false) {
      const previous = appliedStateSync
      const changes = forceProjection ? tuiClientStateChanges(undefined, state) : tuiClientStateChanges(previous, state)
      const rootChanged = changes.catalog || changes.operations || changes.capabilities || changes.presentation
      const projection = rootChanged
        ? projectTuiClientState(state, {
            directory: kv.get("session_directory_filter_enabled", false) ? project.instance.directory() : undefined,
            includeDetails: false,
          })
        : undefined
      const sessionIDs = projection ? new Set(projection.sessions.map((session) => session.id)) : undefined
      const detailChanges = liveDetailChanges
      const targetedDetails = detailChanges !== undefined && detailChanges.size > 0 && !changes.presentation
      const visible = (sessionID: string) =>
        sessionIDs?.has(sessionID) ?? Binary.search(store.session, sessionID, (session) => session.id).found
      const details =
        changes.details || changes.presentation
          ? (targetedDetails
              ? [...detailChanges.keys()].flatMap((sessionID): Array<[string, ClientSessionDetailState]> => {
                  const detail = state.sessionDetails[sessionID]
                  return detail ? [[sessionID, detail]] : []
                })
              : changedTuiSessionDetails(previous, state, changes.presentation)
            ).filter(([sessionID]) => visible(sessionID))
          : []
      appliedStateSync = state
      Object.entries(store.session_pending_prompt).forEach(([sessionID, messageID]) => {
        if (!messageID) return
        const status = state.sessionStatus[sessionID]
        if (status?.type === "busy" || status?.type === "retry") {
          clearTimeout(pendingPromptReleaseTimers.get(sessionID))
          pendingPromptReleaseTimers.delete(sessionID)
          return
        }
        schedulePendingPromptRelease(sessionID)
      })
      batch(() => {
        setStore("state_sync", reconcile(state.lifecycle))
        if (rootChanged && !projection) {
          if (state.lifecycle.data === "empty") clearProjectedState()
          return
        }
        if (projection) {
          setStore("session_sync_revision", projection.revision)
          if (changes.catalog || changes.presentation) {
            setStore("opencodex_project", reconcile(projection.projects))
            setStore("opencodex_view", reconcile(projection.views))
            setStore("session", reconcile(projection.sessions))
            setStore("session_status", reconcile(projection.sessionStatus))
            setStore("session_ui_state", reconcile(projection.sessionUiState))
            setStore("permission", reconcile(projection.permissions))
            setStore("question", reconcile(projection.questions))
          }
          if (changes.operations && projection.jobs && projection.swarms) {
            setStore("opencodex_job", reconcile(projection.jobs))
            setStore("opencodex_swarm", reconcile(projection.swarms))
          }
          if (changes.capabilities && projection.capabilities) {
            setStore("provider", reconcile(projection.capabilities.providers))
            setStore("provider_default", reconcile(projection.capabilities.providerDefaults))
            setStore("provider_next", reconcile(projection.capabilities.providerList))
            setStore("agent", reconcile(projection.capabilities.agents))
            setStore("command", reconcile(projection.capabilities.commands))
            setStore("lsp", reconcile(projection.capabilities.lsp))
            setStore("mcp", reconcile(projection.capabilities.mcp))
            if (projection.capabilities.config) setStore("config", reconcile(projection.capabilities.config))
            setStore("mcp_resource", reconcile(projection.capabilities.mcpResources))
            setStore("formatter", reconcile(projection.capabilities.formatter))
          }
        }
        const removedTarget =
          targetedDetails && [...detailChanges.keys()].some((sessionID) => !state.sessionDetails[sessionID])
        if (changes.presentation || (changes.details && (!targetedDetails || removedTarget)))
          pruneSessionDetails(new Set(Object.keys(state.sessionDetails).filter(visible)))
        details.forEach(([sessionID, detail]) =>
          applySessionDetail(state, sessionID, detail, previous?.sessionDetails[sessionID]),
        )
      })
    }

    function applySessionDetail(
      state: ClientStateSyncState,
      sessionID: string,
      detail: ClientSessionDetailState,
      previous: ClientSessionDetailState | undefined,
    ) {
      const version = `${state.epoch ?? ""}:${detail.revision}`
      if (appliedSessionVersions.get(sessionID) === version) return
      appliedSessionVersions.set(sessionID, version)
      const hinted = liveDetailChanges?.has(sessionID) === true
      const hint = liveDetailChanges?.get(sessionID)
      const pendingPrompt = store.session_pending_prompt[sessionID]
      const response = pendingPrompt
        ? (hinted ? [...(hint?.messageIDs ?? [])] : detail.messageIDs)
            .map((messageID) => detail.messages[messageID])
            .find((message) => message?.role === "assistant" && message.parentID === pendingPrompt)
        : undefined
      if (
        response?.role === "assistant" &&
        (response.time.completed ||
          state.sessionStatus[sessionID]?.type === "busy" ||
          state.sessionStatus[sessionID]?.type === "retry" ||
          (detail.partIDs[response.id]?.length ?? 0) > 0)
      )
        updatePendingPrompt(sessionID, undefined)
      const windowIDs = transcriptWindowIDs(sessionID, detail)
      const messages = store.message[sessionID]
      if (!previous || !messages || messages.length !== windowIDs.length || previous.messageIDs !== detail.messageIDs) {
        replaceSessionDetail(state, sessionID)
        return
      }
      const messageIDs = hinted ? [...(hint?.messageIDs ?? [])] : windowIDs
      messageIDs.forEach((messageID) => {
        const messageIndex = windowIDs.indexOf(messageID)
        if (messageIndex === -1) return
        const message = detail.messages[messageID]
        if (message && previous.messages[messageID] !== message)
          setStore("message", sessionID, messageIndex, reconcile(message))
        const partIDs = detail.partIDs[messageID] ?? []
        const detailParts = detail.parts[messageID]
        const previousParts = previous.parts[messageID]
        const parts = store.part[messageID] ?? []
        if (previous.partIDs[messageID] !== partIDs || parts.length !== partIDs.length) {
          setStore(
            "part",
            messageID,
            reconcile(partIDs.flatMap((partID) => (detailParts?.[partID] ? [displayPart(detailParts[partID])] : []))),
          )
          return
        }
        const changedPartIDs = hinted
          ? [...(hint?.partIDs ?? [])].filter((partID) => Boolean(detailParts?.[partID] ?? previousParts?.[partID]))
          : partIDs
        changedPartIDs.forEach((partID) => {
          const partIndex = partIDs.indexOf(partID)
          if (partIndex === -1) return
          const part = detailParts?.[partID]
          if (part && previousParts?.[partID] !== part)
            setStore("part", messageID, partIndex, reconcile(displayPart(part)))
        })
      })
      if (previous.snapshot.todos !== detail.snapshot.todos)
        setStore("todo", sessionID, reconcile(detail.snapshot.todos))
      if (previous.snapshot.diff !== detail.snapshot.diff)
        setStore("session_diff", sessionID, reconcile(detail.snapshot.diff))
      if (previous.snapshot.session !== detail.snapshot.session) upsertSession(detail.snapshot.session)
    }

    /**
     * Transcript parts land in the store display-ready, so the TUI renders the
     * same prose the GUI does instead of the raw provider envelope. Streaming
     * parts pass through untouched and are normalized once they complete.
     */
    function displayPart(part: Part) {
      return normalizeClientDisplayPart(part)
    }

    function replaceSessionDetail(state: ClientStateSyncState, sessionID: string) {
      const detail = state.sessionDetails[sessionID]
      if (!detail) return
      // Only the windowed slice is projected: building message bundles for
      // history that will never be mounted is the cost this window exists to
      // avoid.
      const messages = transcriptWindowIDs(sessionID, detail).flatMap((messageID) => detail.messages[messageID] ?? [])
      const messageIDs = new Set(messages.map((message) => message.id))
      ;(store.message[sessionID] ?? []).forEach((message) => {
        if (messageIDs.has(message.id)) return
        setStore(
          "part",
          produce((draft) => {
            delete draft[message.id]
          }),
        )
      })
      setStore("message", sessionID, reconcile(messages))
      messages.forEach((message) =>
        setStore(
          "part",
          message.id,
          reconcile(
            (detail.partIDs[message.id] ?? []).flatMap((partID) => {
              const part = detail.parts[message.id]?.[partID]
              return part ? [displayPart(part)] : []
            }),
          ),
        ),
      )
      setStore("todo", sessionID, reconcile(detail.snapshot.todos))
      setStore("session_diff", sessionID, reconcile(detail.snapshot.diff))
      upsertSession(detail.snapshot.session)
    }

    function startStateSync() {
      const workspace = project.workspace.current()
      const directory = project.instance.directory() || sdk.directory
      const scope = `${directory}\n${workspace ?? ""}`
      if (scope === stateSyncScope) return
      unsubscribeStateSync?.()
      stateSync?.stop()
      stateSyncStart = undefined
      clearProjectedState()
      setStore("state_sync", reconcile({ status: "bootstrapping", data: "empty", attempt: 0 }))
      stateSyncScope = scope
      stateSync = createClientStateSync({ client: sdk.client, directory, workspace })
      unsubscribeStateSync = stateSync.subscribe(applyStateSync)
      stateSyncStart = stateSync.start()
      void stateSyncStart.catch((error) => {
        Log.Default.error("tui authoritative state sync failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    async function requireStateSync() {
      startStateSync()
      if (!stateSync || !stateSyncStart) throw new Error("TUI authoritative state sync did not start")
      const controller = stateSync
      await stateSyncStart
      if (controller !== stateSync || controller.getState().phase !== "ready") {
        throw new Error("TUI authoritative state sync changed scope before becoming ready")
      }
      return controller
    }

    function upsertSession(info: Session) {
      const result = Binary.search(store.session, info.id, (s) => s.id)
      if (result.found) {
        setStore("session", result.index, reconcile(info))
        return
      }
      setStore(
        "session",
        produce((draft) => {
          draft.splice(result.index, 0, info)
        }),
      )
    }

    onCleanup(() => {
      pendingPromptReleaseTimers.forEach(clearTimeout)
      pendingPromptReleaseTimers.clear()
      sessionReleaseTimers.forEach(clearTimeout)
      sessionReleaseTimers.clear()
      unsubscribeStateSync?.()
      stateSync?.stop()
    })

    createEffect(startStateSync)

    event.subscribeBatchAll((events) => {
      events.forEach((item) => {
        if (item.event.type === "session.error" && item.event.properties.sessionID) {
          updatePendingPrompt(item.event.properties.sessionID, undefined)
          return
        }
        if (item.event.type === "session.idle") {
          schedulePendingPromptRelease(item.event.properties.sessionID)
          return
        }
        if (item.event.type !== "session.status") return
        if (item.event.properties.status.type === "idle") {
          schedulePendingPromptRelease(item.event.properties.sessionID)
          return
        }
        clearTimeout(pendingPromptReleaseTimers.get(item.event.properties.sessionID))
        pendingPromptReleaseTimers.delete(item.event.properties.sessionID)
      })
      // applyEvents notifies synchronously, so these IDs bound live projection work to this batch.
      liveDetailChanges = collectTuiLiveDetailChanges(events.map((item) => item.event))
      const handled = (() => {
        try {
          return stateSync?.applyEvents(events.map((item) => item.event)) ?? []
        } finally {
          liveDetailChanges = undefined
        }
      })()
      events.forEach((item, index) => {
        if (handled[index]) return
        applyGlobalEventFallback(item.event, item.metadata)
      })
    })

    function updatePendingPrompt(sessionID: string, messageID: string | undefined) {
      clearTimeout(pendingPromptReleaseTimers.get(sessionID))
      pendingPromptReleaseTimers.delete(sessionID)
      setStore("session_pending_prompt", sessionID, messageID)
    }

    function schedulePendingPromptRelease(sessionID: string) {
      const messageID = store.session_pending_prompt[sessionID]
      if (!messageID || pendingPromptReleaseTimers.has(sessionID)) return
      const timer = setTimeout(() => {
        pendingPromptReleaseTimers.delete(sessionID)
        if (store.session_pending_prompt[sessionID] === messageID) updatePendingPrompt(sessionID, undefined)
      }, PENDING_PROMPT_IDLE_RELEASE_MS)
      timer.unref?.()
      pendingPromptReleaseTimers.set(sessionID, timer)
    }

    function applyGlobalEventFallback(event: Event, metadata: { directory: string; workspace: string | undefined }) {
      if (metadata.directory !== "global" && metadata.directory !== project.instance.directory()) return
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap({ refreshState: true })
          break
        case "opencodex.view.created":
        case "opencodex.view.updated":
        case "opencodex.view.reordered":
        case "opencodex.view.deleted":
        case "opencodex.project.created":
        case "opencodex.project.updated":
        case "opencodex.project.reordered":
        case "opencodex.project.deleted":
        case "opencodex.project.session_assigned":
          break

        case "vcs.branch.updated": {
          if (metadata.workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    }

    let rawEventGeneration = 0
    createEffect(() => {
      const generation = sdk.eventConnectionGeneration()
      if (generation === 0) return
      const previous = rawEventGeneration
      rawEventGeneration = generation
      if (previous === 0 || !stateSync || stateSync.getState().phase !== "ready") return
      const controller = stateSync
      // Only sessions something is actually holding get re-tailed. Re-tailing
      // every session ever visited was the reconnect thundering herd.
      void Promise.all([
        controller.refresh(),
        ...[...retainedSessions.keys()].map((sessionID) =>
          controller.refreshSessionTail(sessionID, { limit: TUI_SESSION_TAIL_LIMIT }),
        ),
      ]).catch((error) => {
        Log.Default.warn("tui reconnect correction failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })

    const exit = useExit()
    async function bootstrap(input: { fatal?: boolean; refreshState?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const stateSyncPromise = projectPromise.then(async () => {
        const controller = await requireStateSync()
        await Promise.all([
          input.refreshState ? controller.refresh() : Promise.resolve(),
          controller.refreshCapabilities(),
        ])
      })

      const blockingRequests: { name: string; promise: Promise<unknown> }[] = [
        { name: "project.sync", promise: projectPromise },
        { name: "opencodex.state", promise: stateSyncPromise },
      ]

      await Promise.allSettled(blockingRequests.map((r) => r.promise))
        .then((settled) => {
          // Surface every failed endpoint in one labeled message instead of
          // letting the first rejection drown its siblings as unhandled
          // rejections.
          const failure = aggregateFailures(blockingRequests.map((r, i) => ({ name: r.name, result: settled[i] })))
          if (failure) throw failure
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            await exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (process.env.OPENCODE_FAST_BOOT) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const controller = await requireStateSync()
          await controller.refresh()
          applyStateSync(controller.getState(), true)
        },
        get hasMore() {
          return stateSync?.getState().sessionCards.hasMore ?? false
        },
        async loadMore() {
          const controller = await requireStateSync()
          if (!controller.getState().sessionCards.hasMore) return false
          await controller.loadSessionCards()
          return true
        },
        async ensure(sessionIDs: readonly string[]) {
          const controller = await requireStateSync()
          await controller.ensureSessionCards(sessionIDs)
        },
        async refreshStatus() {
          const controller = await requireStateSync()
          await controller.refresh()
        },
        setPendingPrompt(sessionID: string, messageID: string | undefined) {
          updatePendingPrompt(sessionID, messageID)
        },
        /**
         * Loads the newest page of a session. Older history stays behind
         * "load older" - walking every page here is what made opening a long
         * transcript cost the whole session.
         */
        async sync(sessionID: string) {
          if (hydratedSessions.has(sessionID)) return
          const controller = await requireStateSync()
          await controller
            .refreshSessionTail(sessionID, { limit: TUI_SESSION_TAIL_LIMIT })
            .then((snapshot) => {
              hydratedSessions.add(sessionID)
              setStore(
                "session_transcript",
                sessionID,
                reconcile(tuiTranscriptFromTail(snapshot.messages.boundary, store.session_transcript[sessionID])),
              )
            })
            .catch((error) => {
              Log.Default.warn("tui session hydration failed", {
                sessionID,
                error: error instanceof Error ? error.message : String(error),
              })
            })
        },
        retain(sessionID: string) {
          return retainSession(sessionID)
        },
        transcript(sessionID: string): TuiTranscriptWindow {
          return store.session_transcript[sessionID] ?? EMPTY_TUI_TRANSCRIPT_WINDOW
        },
        async loadOlder(sessionID: string) {
          const current = store.session_transcript[sessionID]
          if (!current?.hasOlder || current.loadingOlder || !current.olderCursor) return false
          const cursor = current.olderCursor
          const controller = await requireStateSync()
          // `expanded` goes up front: the page lands through the subscriber
          // before this promise resolves, and the render cap would otherwise
          // trim away exactly what was just asked for.
          setStore("session_transcript", sessionID, reconcile({ ...current, loadingOlder: true, expanded: true }))
          try {
            const page = await controller.loadOlderSessionPage(sessionID, {
              before: cursor,
              limit: TUI_SESSION_PAGE_LIMIT,
            })
            setStore(
              "session_transcript",
              sessionID,
              reconcile(
                tuiTranscriptAfterOlderPage(store.session_transcript[sessionID] ?? current, page.messages.boundary),
              ),
            )
            return true
          } catch (error) {
            Log.Default.warn("tui session older page failed", {
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
            setStore("session_transcript", sessionID, reconcile({ ...current, loadingOlder: false }))
            return false
          }
        },
        /**
         * Reads a session's full history without hydrating it. For export,
         * copy and timeline search, which need every message but must not drag
         * the transcript back into resident state.
         */
        async transcriptMessages(sessionID: string) {
          const controller = await requireStateSync()
          const transcript = await loadClientSessionTranscript(controller, sessionID, {
            pageLimit: TUI_SESSION_TRANSCRIPT_PAGE_LIMIT,
          })
          return transcript.messages
        },
      },
      stateSync: {
        get lifecycle() {
          return store.state_sync
        },
        async retry() {
          startStateSync()
          if (!stateSync) throw new Error("TUI authoritative state sync did not start")
          await stateSync.retry()
        },
      },
      bootstrap,
    }
    return result
  },
})
