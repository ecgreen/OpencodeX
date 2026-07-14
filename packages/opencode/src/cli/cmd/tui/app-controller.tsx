import { Flag } from "@opencode-ai/core/flag/flag"
import type { Session } from "@opencode-ai/sdk/v2"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { Provider } from "@/provider/provider"
import { Session as SessionApi } from "@/session/session"
import { createTuiAttention } from "./attention"
import { DialogProviderList } from "./component/dialog-provider"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "./component/opencodex-session-state"
import { useConnected } from "./component/use-connected"
import { useArgs } from "./context/args"
import { useEvent } from "./context/event"
import { useExit } from "./context/exit"
import { useKV } from "./context/kv"
import { useLocal } from "./context/local"
import { useProject } from "./context/project"
import { usePromptRef } from "./context/prompt"
import { useRoute } from "./context/route"
import { useSDK } from "./context/sdk"
import { useSync } from "./context/sync"
import { useTheme } from "./context/theme"
import { useTuiConfig } from "./context/tui-config"
import { createTuiApi, type RouteMap } from "./plugin/api"
import { TuiPluginRuntime } from "./plugin/runtime"
import { useOpencodeKeymap } from "./keymap"
import { useDialog } from "./ui/dialog"
import { useToast } from "./ui/toast"
import { Clipboard } from "./util/clipboard"
import { Selection } from "./util/selection"

export function createTuiAppController(props: { onSnapshot?: () => Promise<string[]> }) {
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const [, setOxSidebarOpen] = kv.signal<boolean>("ox_sidebar_visible", false)
  const keymap = useOpencodeKeymap()
  const event = useEvent()
  const sdk = useSDK()
  const toast = useToast()
  const themeState = useTheme()
  const sync = useSync()
  const project = useProject()
  const exit = useExit()
  const promptRef = usePromptRef()
  const routes: RouteMap = new Map()
  const [routeRev, setRouteRev] = createSignal(0)
  const attention = createTuiAttention({ renderer, config: tuiConfig, kv })
  const api = createTuiApi({
    tuiConfig,
    dialog,
    keymap,
    kv,
    route,
    routes,
    bump: () => setRouteRev((value) => value + 1),
    event,
    sdk,
    sync,
    theme: themeState,
    toast,
    renderer,
    attention,
  })
  const [ready, setReady] = createSignal(false)
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))
  const [pasteSummaryEnabled, setPasteSummaryEnabled] = createSignal(
    kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary),
  )
  const args = useArgs()
  const connected = useConnected()

  TuiPluginRuntime.init({ api, config: tuiConfig, dispose: () => attention.dispose() })
    .catch((error) => console.error("Failed to load TUI plugins", error))
    .finally(() => setReady(true))

  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
      Selection.handleSelectionKey(renderer, toast, event)
    },
    { priority: 1 },
  )
  onCleanup(() => {
    offSelectionKeys()
    attention.dispose()
  })

  renderer.console.onCopySelection = async (text: string) => {
    if (!text) return
    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)
    renderer.clearSelection()
  }

  createEffect(() => {
    if (route.data.type !== "session") return
    setPendingOpencodeXProjectSession(undefined)
    setPendingOpencodeXSwarmTask(undefined)
  })

  const activeStartedSwarmSession = createMemo(() => {
    if (route.data.type !== "session") return false
    const sessionID = route.data.sessionID
    if (!(sync.data.message[sessionID] ?? []).some((message) => message.role === "user")) return false
    let session = sync.session.get(sessionID)
    const seen = new Set<string>()
    while (session && !seen.has(session.id)) {
      seen.add(session.id)
      if (sessionOpencodeXSwarmID(session)) return true
      session = session.parentID ? sync.session.get(session.parentID) : undefined
    }
    return false
  })

  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.OPENCODE_DISABLE_TERMINAL_TITLE) return
    renderer.setTerminalTitle(routeTitle(route.data, sync))
  })

  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const parsed = Provider.parseModel(args.model)
        if (!parsed.providerID || !parsed.modelID) {
          toast.show({ variant: "warning", message: `Invalid model format: ${args.model}`, duration: 3000 })
          return
        }
        local.model.set({ providerID: parsed.providerID, modelID: parsed.modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) route.navigate({ type: "session", sessionID: args.sessionID })
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || sync.status === "loading" || !args.continue) return
    const sessionID = sync.data.session.toSorted((a, b) => b.time.updated - a.time.updated).find((session) => !session.parentID)?.id
    if (!sessionID) return
    continued = true
    if (!args.fork) {
      route.navigate({ type: "session", sessionID })
      return
    }
    void sdk.client.session.fork({ sessionID }).then((result) => {
      if (result.data?.id) return route.navigate({ type: "session", sessionID: result.data.id })
      toast.show({ message: "Failed to fork session", variant: "error" })
    })
  })

  let forked = false
  createEffect(() => {
    if (forked || sync.status !== "complete" || !args.sessionID || !args.fork) return
    forked = true
    void sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
      if (result.data?.id) return route.navigate({ type: "session", sessionID: result.data.id })
      toast.show({ message: "Failed to fork session", variant: "error" })
    })
  })

  createEffect(on(
    () => sync.status === "complete" && sync.data.provider.length === 0,
    (empty, wasEmpty) => {
      if (!empty || wasEmpty) return
      dialog.replace(() => <DialogProviderList />)
    },
  ))

  const currentWorktreeWorkspace = createMemo(() => {
    const workspaceID = project.workspace.current()
    if (!workspaceID) return
    const workspace = project.workspace.get(workspaceID)
    return workspace?.type === "worktree" && workspace.directory ? workspace : undefined
  })
  const plugin = createMemo(() => {
    if (!ready() || route.data.type !== "plugin") return
    routeRev()
    const render = routes.get(route.data.id)?.at(-1)?.render
    if (!render) return <PluginRouteMissing id={route.data.id} onHome={() => route.navigate({ type: "home" })} />
    return render({ params: route.data.data })
  })

  return {
    props, tuiConfig, route, dimensions, renderer, dialog, local, kv, setOxSidebarOpen, keymap, event, sdk, toast,
    themeState, sync, project, exit, promptRef, ready, terminalTitleEnabled, setTerminalTitleEnabled,
    pasteSummaryEnabled, setPasteSummaryEnabled, connected, currentWorktreeWorkspace, activeStartedSwarmSession,
    warnStartedSwarmSwitch: () => toast.show({ message: "Started swarm sessions cannot switch model or swarm.", variant: "warning", duration: 3000 }),
    plugin,
  }
}

function sessionOpencodeXSwarmID(session: Session | undefined) {
  const opencodex = session?.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

function routeTitle(route: ReturnType<typeof useRoute>["data"], sync: ReturnType<typeof useSync>) {
  if (route.type === "home") return "OpenCode"
  if (route.type === "opencodex-dashboard") return "OC | Operations"
  if (route.type === "opencodex-swarms") return "OC | Swarms"
  if (route.type === "opencodex-swarm-create") return "OC | Create Swarm"
  if (route.type === "opencodex-view") return "OC | View"
  if (route.type === "plugin") return `OC | ${route.id}`
  if (route.type !== "session") return "OpenCode"
  const session = sync.session.get(route.sessionID)
  if (!session || SessionApi.isDefaultTitle(session.title)) return "OpenCode"
  return `OC | ${session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title}`
}
