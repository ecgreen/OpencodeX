import { useTerminalDimensions } from "@opentui/solid"
import { clientSwarmDisplayStatus, isActiveSwarmStatus } from "@opencode-ai/sdk/v2/swarm-presentation"
import type { PromptRef } from "@tui/component/prompt"
import { useLocal } from "@tui/context/local"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { useTuiConfig } from "../context/tui-config"
import { useBindings, useCommandShortcut } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import { swarmNavigationRouteBindingCommands } from "./opencodex-operation-bindings"
import type { OpencodeXProject, OpencodeXSwarm } from "./opencodex-operations-types"
import { refreshOpencodeXSidebar } from "./opencodex-refresh"
import { setPendingOpencodeXProjectSession, setPendingOpencodeXSwarmTask } from "./opencodex-session-state"
import { useOxSidebar } from "./opencodex-sidebar"
import { sendPromptToSession } from "@tui/component/prompt/submit-session"

export function createOpencodeXSwarmsController() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [selected, setSelected] = createSignal(0)
  const [activeCollapsed, setActiveCollapsed] = createSignal(false)
  const [inactiveCollapsed, setInactiveCollapsed] = createSignal(false)
  const projects = createMemo(() => sync.data.opencodex_project as OpencodeXProject[])
  const swarms = createMemo(() => sync.data.opencodex_swarm as OpencodeXSwarm[])
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    return configured === "auto" ? Math.max(75, Math.floor(dimensions().width * 0.7)) : configured ?? 75
  })
  const cardWidth = createMemo(() => dimensions().width >= 150 ? 42 : dimensions().width >= 110 ? 38 : 34)
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const displaySwarmStatus = (swarm: OpencodeXSwarm) => clientSwarmDisplayStatus(swarm)
  const active = createMemo(() => swarms().filter((swarm) => isActiveSwarmStatus(displaySwarmStatus(swarm))).toSorted((a, b) => b.timeUpdated - a.timeUpdated))
  const inactive = createMemo(() => swarms().filter((swarm) => !isActiveSwarmStatus(displaySwarmStatus(swarm))).toSorted((a, b) => b.timeUpdated - a.timeUpdated))
  const list = createMemo(() => [...active(), ...inactive()])
  const visibleList = createMemo(() => [...(activeCollapsed() ? [] : active()), ...(inactiveCollapsed() ? [] : inactive())])
  const current = createMemo(() => swarms().find((swarm) => route.data.type === "opencodex-swarms" && swarm.id === route.data.swarmID))
  const promptTarget = createMemo(() => current() ?? visibleList()[selected()] ?? list()[0])
  const previousShortcut = useCommandShortcut("opencodex.swarm.route.up")
  const nextShortcut = useCommandShortcut("opencodex.swarm.route.down")
  const createShortcut = useCommandShortcut("opencodex.swarm.route.create")
  const dashboardShortcut = useCommandShortcut("opencodex.swarm.route.dashboard")
  const refreshShortcut = useCommandShortcut("opencodex.swarm.route.refresh")
  const shortcutHint = createMemo(() => {
    if (route.data.type === "opencodex-swarms" && route.data.swarmID) return ["enter new task", createShortcut() && `${createShortcut()} new task`, dashboardShortcut() && `${dashboardShortcut()} dashboard`, refreshShortcut() && `${refreshShortcut()} refresh`].filter(Boolean).join("  ")
    const selectHint = [previousShortcut(), nextShortcut()].filter(Boolean).join("/")
    return [selectHint && `${selectHint} select`, createShortcut() && `${createShortcut()} create`, dashboardShortcut() && `${dashboardShortcut()} dashboard`, refreshShortcut() && `${refreshShortcut()} refresh`].filter(Boolean).join("  ")
  })
  const detailMaxWidth = createMemo(() => Math.min(promptMaxWidth(), 88))
  const bindPrompt = (ref: PromptRef | undefined) => promptRef.set(ref)

  createEffect(() => {
    if (route.data.type === "opencodex-swarms" && !route.data.swarmID) route.navigate({ type: "opencodex-dashboard" })
  })
  createEffect(() => {
    if (route.data.type !== "opencodex-swarms" || !route.data.swarmID) return
    promptRef.current?.blur()
    promptRef.set(undefined)
  })
  createEffect(() => {
    if (selected() >= visibleList().length) setSelected(Math.max(0, visibleList().length - 1))
  })
  onMount(() => setOxSidebarOpen(() => true))

  async function startRun(prompt: { input: string }) {
    const swarm = promptTarget()
    if (!swarm) {
      await DialogAlert.show(dialog, "Assign Task", "Create a swarm before assigning a task.")
      return false
    }
    if (swarm.status === "cancelled") {
      await DialogAlert.show(dialog, "Assign Task", "Cancelled swarms cannot accept new tasks.")
      return false
    }
    const runPrompt = prompt.input.trim()
    if (!runPrompt) return false
    // A swarm task is an ordinary session on the swarm model: the orchestrator
    // answers and delegates specialists inside that session. A project is only
    // the session's default workspace - a swarm without one runs right here.
    const project = swarm.projectID ? projects().find((item) => item.id === swarm.projectID) : undefined
    const directory = project?.folders?.[0]?.path ?? project?.project.worktree
    const model = { providerID: "swarm", modelID: swarm.id }
    const session = project
      ? await sdk.request<{ id: string }>("/experimental/opencodex/session", {
          method: "POST",
          body: JSON.stringify({
            projectID: project.id,
            directory,
            agent: local.agent.current()?.name,
            model: { providerID: model.providerID, id: model.modelID },
          }),
        }).catch((error: Error) => void DialogAlert.show(dialog, "Assign Task", error.message))
      : await sdk.client.session
          .create({ agent: local.agent.current()?.name, model: { providerID: model.providerID, id: model.modelID } })
          .then((result) => {
            if (result.data) return result.data
            void DialogAlert.show(dialog, "Assign Task", "Creating a session failed.")
            return undefined
          })
    if (!session) return false
    // One-shot retainer: the session route or view pane picks the session up
    // inside the deferred-release grace period.
    const release = sync.session.retain(session.id)
    await sync.session.sync(session.id).finally(release)
    sendPromptToSession({
      sdk,
      sync,
      sessionID: session.id,
      agent: local.agent.current()?.name ?? "build",
      model,
      variant: undefined,
      mode: "normal",
      text: runPrompt,
      parts: [],
      editorSelectionPending: false,
    })
    local.model.set(model, { recent: true })
    refreshOpencodeXSidebar()
    route.navigate({ type: "session", sessionID: session.id })
    return true
  }

  function select(offset: number) {
    // The detail page is a single "New Task" card, so there is nothing to move between.
    if (route.data.type === "opencodex-swarms" && route.data.swarmID) return
    if (visibleList().length === 0) return
    const next = Math.min(Math.max(selected() + offset, 0), visibleList().length - 1)
    setSelected(next)
    route.navigate({ type: "opencodex-swarms", swarmID: visibleList()[next]?.id })
  }
  function toggleActive() {
    const next = !activeCollapsed()
    setActiveCollapsed(next)
    if (next && selected() < active().length) {
      setSelected(0)
      if (inactive().length > 0) route.navigate({ type: "opencodex-swarms", swarmID: inactive()[0]?.id })
    }
  }
  function toggleInactive() {
    const next = !inactiveCollapsed()
    setInactiveCollapsed(next)
    if (next && selected() >= active().length) {
      setSelected(0)
      if (active().length > 0) route.navigate({ type: "opencodex-swarms", swarmID: active()[0]?.id })
    }
  }
  function newTask(swarm: OpencodeXSwarm | undefined) {
    if (!swarm) return
    setPendingOpencodeXProjectSession(undefined)
    setPendingOpencodeXSwarmTask({ swarmID: swarm.id, title: swarm.title })
    route.navigate({ type: "home" })
  }
  function openSelected() {
    newTask(current())
  }
  const createSwarm = () => route.navigate({ type: "opencodex-swarm-create" })
  const back = () => route.back({ type: "opencodex-dashboard" })
  async function removeSwarm(swarm: OpencodeXSwarm) {
    const confirmed = await DialogConfirm.show(dialog, "Delete swarm", `Delete "${swarm.title}"? This removes the swarm, roles, tasks, and events.`, "keep")
    if (confirmed !== true) return
    const removed = await sdk.request<boolean>(`/experimental/opencodex/swarm/${swarm.id}`, { method: "DELETE" }).catch((error: Error) => void DialogAlert.show(dialog, "Delete Swarm", error.message))
    if (!removed) return
    void sync.session.refresh()
    refreshOpencodeXSidebar()
    back()
  }
  async function cancelSwarm(swarm: OpencodeXSwarm | undefined) {
    if (!swarm || !isActiveSwarmStatus(displaySwarmStatus(swarm))) return
    const cancelled = await sdk.request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${swarm.id}/cancel`, { method: "POST" }).catch((error: Error) => void DialogAlert.show(dialog, "Cancel Swarm", error.message))
    if (!cancelled) return
    void sync.session.refresh()
    refreshOpencodeXSidebar()
  }
  const openCurrent = () => {
    if (route.data.type === "opencodex-swarms" && route.data.swarmID) return openSelected()
    const swarm = current() ?? visibleList()[selected()]
    if (swarm) route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
  }
  const createCurrent = () => route.data.type === "opencodex-swarms" && route.data.swarmID ? newTask(current()) : createSwarm()
  const moveHorizontal = (offset: -1 | 1) => route.data.type === "opencodex-swarms" && route.data.swarmID ? undefined : select(offset)

  useBindings(() => ({
    enabled: route.data.type === "opencodex-swarms",
    commands: [
      { name: "opencodex.swarm.route.up", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select previous swarm", category: "OpencodeX", run: () => select(-1) },
      { name: "opencodex.swarm.route.down", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select next swarm", category: "OpencodeX", run: () => select(1) },
      { name: "opencodex.swarm.route.left", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select previous swarm", category: "OpencodeX", run: () => moveHorizontal(-1) },
      { name: "opencodex.swarm.route.right", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select next swarm", category: "OpencodeX", run: () => moveHorizontal(1) },
      { name: "opencodex.swarm.route.open", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Open selected swarm", category: "OpencodeX", run: openCurrent },
      { name: "opencodex.swarm.route.create", title: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Create swarm", category: "OpencodeX", run: createCurrent },
      { name: "opencodex.swarm.route.back", title: "Back", category: "OpencodeX", run: back },
      { name: "opencodex.swarm.route.dashboard", title: "Open dashboard", category: "OpencodeX", run: () => route.navigate({ type: "opencodex-dashboard" }) },
      { name: "opencodex.swarm.route.refresh", title: "Refresh swarms", category: "OpencodeX", run: () => void sync.session.refresh() },
      { name: "opencodex.swarm.route.cancel", title: "Cancel selected swarm", category: "OpencodeX", run: () => void cancelSwarm(current()) },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("opencodex.swarm.route", swarmNavigationRouteBindingCommands),
      { key: "up,k", desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select previous", group: "OpencodeX", cmd: () => select(-1) },
      { key: "down,j", desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select next", group: "OpencodeX", cmd: () => select(1) },
      { key: "left,h", desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select previous", group: "OpencodeX", cmd: () => moveHorizontal(-1) },
      { key: "right,l", desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Select next", group: "OpencodeX", cmd: () => moveHorizontal(1) },
      { key: "return,space", desc: route.data.type === "opencodex-swarms" && route.data.swarmID ? "New task" : "Open selected swarm", group: "OpencodeX", cmd: openCurrent },
      ...(route.data.type === "opencodex-swarms" && route.data.swarmID ? [{ key: "escape", desc: "Back to previous page", group: "OpencodeX", cmd: back }] : []),
    ],
  }))

  return {
    route, theme, projects, swarms, promptMaxWidth, cardWidth, scrollAcceleration, displaySwarmStatus, active, inactive,
    list, current, promptTarget, shortcutHint, detailMaxWidth, bindPrompt, startRun, activeCollapsed,
    inactiveCollapsed, toggleActive, toggleInactive, createSwarm, newTask,
    removeSwarm, cancelSwarm,
  }
}
