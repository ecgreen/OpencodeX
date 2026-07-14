import type {
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
  ClientStateSyncLifecycle,
  ClientStateSyncState,
  OpencodeXProject,
  OpencodeXJob,
  OpencodeXSwarm,
  OpencodeXView,
  OpencodeXSessionUiState,
} from "@opencode-ai/sdk/v2"
import {
  createClientStateSync,
} from "@opencode-ai/sdk/v2"
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
import { emptyConsoleState, type ConsoleState } from "@/config/console-state"
import path from "path"
import { useKV } from "./kv"
import { aggregateFailures } from "./aggregate-failures"
import { projectTuiClientState } from "./sync-state"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      state_sync: ClientStateSyncLifecycle
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
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
      opencodex_project: OpencodeXProject[]
      opencodex_job: OpencodeXJob[]
      opencodex_swarm: OpencodeXSwarm[]
      opencodex_view: OpencodeXView[]
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_ui_state: {
        [sessionID: string]: OpencodeXSessionUiState
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
      console_state: emptyConsoleState,
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

    const fullSyncedSessions = new Set<string>()
    const appliedSessionVersions = new Map<string, string>()
    let stateSync: ClientStateSyncController | undefined
    let stateSyncStart: Promise<void> | undefined
    let unsubscribeStateSync: (() => void) | undefined
    let stateSyncScope = ""

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function applyStateSync(state: ClientStateSyncState) {
      const projection = projectTuiClientState(state, {
        directory: kv.get("session_directory_filter_enabled", true) ? project.instance.directory() : undefined,
      })
      batch(() => {
        setStore("state_sync", reconcile(state.lifecycle))
        if (!projection) return
        setStore("session_sync_revision", projection.revision)
        setStore("opencodex_project", reconcile(projection.projects))
        setStore("opencodex_view", reconcile(projection.views))
        if (projection.jobs && projection.swarms) {
          setStore("opencodex_job", reconcile(projection.jobs))
          setStore("opencodex_swarm", reconcile(projection.swarms))
        }
        setStore("session", reconcile(projection.sessions))
        setStore("session_status", reconcile(projection.sessionStatus))
        setStore("session_ui_state", reconcile(projection.sessionUiState))
        setStore("permission", reconcile(projection.permissions))
        setStore("question", reconcile(projection.questions))
        if (projection.capabilities) {
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
        Object.entries(projection.details).forEach(([sessionID, detail]) => {
          if (appliedSessionVersions.get(sessionID) === detail.version) return
          appliedSessionVersions.set(sessionID, detail.version)
          const messages = detail.messages
          const messageIDs = new Set(messages.map((message) => message.info.id))
          ;(store.message[sessionID] ?? []).forEach((message) => {
            if (messageIDs.has(message.id)) return
            setStore(
              "part",
              produce((draft) => {
                delete draft[message.id]
              }),
            )
          })
          setStore("message", sessionID, reconcile(messages.map((message) => message.info)))
          messages.forEach((message) => setStore("part", message.info.id, reconcile(message.parts)))
          setStore("todo", sessionID, reconcile(detail.todos))
          setStore("session_diff", sessionID, reconcile(detail.diff))
          upsertSession(detail.session)
        })
      })
    }

    function startStateSync() {
      const workspace = project.workspace.current()
      const directory = project.instance.directory() || sdk.directory
      const scope = `${directory}\n${workspace ?? ""}`
      if (scope === stateSyncScope) return
      unsubscribeStateSync?.()
      stateSync?.stop()
      stateSyncStart = undefined
      fullSyncedSessions.clear()
      appliedSessionVersions.clear()
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
      unsubscribeStateSync?.()
      stateSync?.stop()
    })

    createEffect(startStateSync)

    event.subscribe((event, { workspace }) => {
      if (stateSync?.applyEvent(event)) return
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
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
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

      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
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
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
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
          applyStateSync(controller.getState())
        },
        async refreshStatus() {
          const controller = await requireStateSync()
          await controller.refresh()
          applyStateSync(controller.getState())
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          await (await requireStateSync())
            .hydrateSession(sessionID, { limit: 100 })
            .then(() => fullSyncedSessions.add(sessionID))
            .catch((error) => {
              Log.Default.warn("tui session hydration failed", {
                sessionID,
                error: error instanceof Error ? error.message : String(error),
              })
            })
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
