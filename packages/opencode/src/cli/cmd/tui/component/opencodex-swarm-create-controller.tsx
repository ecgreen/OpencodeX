import { useTerminalDimensions } from "@opentui/solid"
import { DialogModel } from "@tui/component/dialog-model"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createEffect, createMemo, createResource, createSignal, onMount } from "solid-js"
import { useTuiConfig } from "../context/tui-config"
import { useBindings } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import { useOxSidebar } from "./opencodex-sidebar"
import { projectTitle, swarmLeadRole, swarmSpecialistRoles } from "./opencodex-operation-model"
import { swarmRouteBindingCommands } from "./opencodex-operation-bindings"
import type { ModelSelection, OpencodeXProject, OpencodeXSwarm, SwarmRoleDraft, SwarmRolePreset } from "./opencodex-operations-types"
import { createRoleDraft, ORCHESTRATOR_PRESET, roleDraftFromSwarmRole, roleInstructions, SWARM_ROLE_PRESETS } from "./opencodex-swarm-role-model"

export function createOpencodeXSwarmCreateController() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [projects] = createResource(() => sdk.request<OpencodeXProject[]>("/experimental/opencodex/project"))
  const editSwarmID = createMemo(() => route.data.type === "opencodex-swarm-create" ? route.data.swarmID : undefined)
  const [editSwarm] = createResource(editSwarmID, (swarmID) => swarmID ? sdk.request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${swarmID}`) : undefined)
  const initialModel = local.model.current()
  const [projectID, setProjectID] = createSignal<string>()
  const [title, setTitle] = createSignal("")
  const [orchestrator, setOrchestrator] = createSignal(createRoleDraft(ORCHESTRATOR_PRESET, initialModel))
  const [roles, setRoles] = createSignal<SwarmRoleDraft[]>([])
  const [selected, setSelected] = createSignal(0)
  const [creating, setCreating] = createSignal(false)
  const [initializedSwarmID, setInitializedSwarmID] = createSignal<string>()
  const editing = createMemo(() => editSwarmID() !== undefined)
  const promptMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    return configured === "auto" ? Math.max(75, Math.floor(dimensions().width * 0.7)) : configured ?? 75
  })
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const selectedRoles = createMemo(roles)
  const availableRoles = createMemo(() => SWARM_ROLE_PRESETS)
  const editorItems = createMemo(() => [
    ...(!editing() ? [{ id: "project", action: selectProject }] : []),
    { id: "title", action: editTitle },
    { id: "orchestrator-name", action: editOrchestratorName },
    { id: "orchestrator-model", action: () => selectModel("orchestrator") },
    { id: "orchestrator-instructions", action: () => editInstructions("orchestrator") },
    ...roles().flatMap((role) => [
      { id: `role:${role.draftID}`, action: () => editInstructions(role.draftID) },
      { id: `role-model:${role.draftID}`, action: () => selectModel(role.draftID) },
      { id: `role-instructions:${role.draftID}`, action: () => editInstructions(role.draftID) },
      { id: `role-remove:${role.draftID}`, action: () => removeRole(role.draftID) },
    ]),
    { id: "add-agent", action: () => void addAgent() },
    { id: "create", action: saveSwarm },
    { id: "cancel", action: cancelCreate },
  ])

  createEffect(() => {
    if (selected() >= editorItems().length) setSelected(Math.max(0, editorItems().length - 1))
  })

  onMount(() => setOxSidebarOpen(() => true))

  createEffect(() => {
    const swarm = editSwarm()
    if (!swarm || initializedSwarmID() === swarm.id) return
    const lead = swarmLeadRole(swarm.roles)
    setProjectID(swarm.projectID)
    setTitle(swarm.title)
    setOrchestrator(lead ? roleDraftFromSwarmRole(lead) : createRoleDraft(ORCHESTRATOR_PRESET, initialModel))
    setRoles(swarmSpecialistRoles(swarm.roles).map(roleDraftFromSwarmRole))
    setInitializedSwarmID(swarm.id)
  })

  function isSelected(id: string) {
    return editorItems()[selected()]?.id === id
  }

  function move(offset: number) {
    const count = editorItems().length
    if (count > 0) setSelected((selected() + offset + count) % count)
  }

  function openSelected() {
    editorItems()[selected()]?.action()
  }

  function updateRole(roleID: string, update: (role: SwarmRoleDraft) => SwarmRoleDraft) {
    if (roleID === "orchestrator") {
      setOrchestrator((role) => update(role))
      return
    }
    setRoles((items) => items.map((role) => role.draftID === roleID ? update(role) : role))
  }

  function removeRole(roleID: string) {
    setRoles((items) => items.filter((role) => role.draftID !== roleID))
  }

  function cancelCreate() {
    route.back(editSwarmID() ? { type: "opencodex-swarms", swarmID: editSwarmID() } : { type: "opencodex-dashboard" })
  }

  function selectProject() {
    const list = projects() ?? []
    if (list.length === 0) return
    dialog.replace(() => (
      <DialogSelect
        title="Swarm project"
        options={list.map((project) => ({
          title: projectTitle(list, project.id),
          value: project.id,
          footer: project.project.worktree,
          onSelect: () => {
            setProjectID(project.id)
            dialog.clear()
          },
        }))}
        current={projectID()}
      />
    ))
  }

  function selectAgentRole() {
    const list = availableRoles()
    if (list.length === 0) {
      void DialogAlert.show(dialog, "Add Specialist", "No predefined specialist roles are available.")
      return Promise.resolve(undefined)
    }
    return new Promise<SwarmRolePreset | undefined>((resolve) => {
      const settle = (value?: SwarmRolePreset) => resolve(value)
      dialog.replace(
        () => <DialogSelect title="Specialist role" options={list.map((role) => ({ title: role.name, value: role, description: role.description, footer: `${role.skill}.md`, onSelect: (ctx) => { settle(role); ctx.clear() } }))} />,
        () => settle(),
      )
    })
  }

  function selectAgentModel(role: SwarmRoleDraft) {
    return new Promise<ModelSelection | undefined>((resolve) => {
      const settle = (value?: ModelSelection) => resolve(value)
      dialog.replace(
        () => <DialogModel current={role.providerID && role.modelID ? { providerID: role.providerID, modelID: role.modelID } : undefined} onSelect={settle} />,
        () => settle(),
      )
    })
  }

  async function addAgent() {
    const preset = await selectAgentRole()
    if (!preset) return
    const model = await selectAgentModel(createRoleDraft(preset, initialModel))
    if (!model) return
    const instructions = await DialogPrompt.show(dialog, `${preset.name} instructions`, {
      placeholder: "Optional custom instructions",
      description: () => <text fg={theme.textMuted}>Default guidance comes from {preset.skill}.md; this field appends extra instructions.</text>,
    })
    if (instructions === null) return
    const nextRoles = [...roles(), { ...createRoleDraft(preset, model), customInstructions: instructions }]
    setRoles(nextRoles)
    setSelected(5 + nextRoles.length * 4)
  }

  async function editTitle() {
    const value = await DialogPrompt.show(dialog, "Swarm title", {
      placeholder: "Optional title",
      value: title(),
      description: () => <text fg={theme.textMuted}>Leave blank to use the first task as the title later.</text>,
    })
    if (value !== null) setTitle(value)
  }

  async function editOrchestratorName() {
    const value = await DialogPrompt.show(dialog, "Orchestrator name", {
      placeholder: "Orchestrator",
      value: orchestrator().name,
      description: () => <text fg={theme.textMuted}>The orchestrator is always the first swarm role.</text>,
    })
    if (value === null) return
    const name = value.trim()
    if (!name) {
      await DialogAlert.show(dialog, "Create Swarm", "Orchestrator name cannot be empty.")
      return
    }
    setOrchestrator((role) => ({ ...role, name }))
  }

  function selectModel(roleID: string) {
    const role = roleID === "orchestrator" ? orchestrator() : roles().find((item) => item.draftID === roleID)
    if (!role) return
    dialog.replace(() => <DialogModel current={role.providerID && role.modelID ? { providerID: role.providerID, modelID: role.modelID } : undefined} onSelect={(model) => updateRole(roleID, (item) => ({ ...item, providerID: model.providerID, modelID: model.modelID }))} />)
  }

  async function editInstructions(roleID: string) {
    const role = roleID === "orchestrator" ? orchestrator() : roles().find((item) => item.draftID === roleID)
    if (!role) return
    const value = await DialogPrompt.show(dialog, `${role.name} instructions`, {
      placeholder: "Optional custom instructions",
      value: role.customInstructions,
      description: () => <text fg={theme.textMuted}>Default guidance comes from {role.skill}.md; this field appends extra instructions.</text>,
    })
    if (value !== null) updateRole(roleID, (item) => ({ ...item, customInstructions: value }))
  }

  async function saveSwarm() {
    if (creating()) return
    if (editing() && !editSwarm()) {
      await DialogAlert.show(dialog, "Edit Swarm", "Swarm config is still loading.")
      return
    }
    const project = projectID()
    if (!project && !editing()) {
      await DialogAlert.show(dialog, "Create Swarm", "Select an OpencodeX project first.")
      return
    }
    const lead = orchestrator()
    if (!lead.providerID || !lead.modelID) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Select the orchestrator model first.")
      return
    }
    if (selectedRoles().length === 0) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Add at least one specialist role.")
      return
    }
    if (selectedRoles().some((role) => !role.providerID || !role.modelID)) {
      await DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", "Select a model for every specialist role.")
      return
    }
    setCreating(true)
    const payload = {
      title: title().trim() || undefined,
      roles: [lead, ...selectedRoles()].map((role) => ({ name: role.name, skill: role.skill, providerID: role.providerID, modelID: role.modelID, instructions: roleInstructions(role) })),
    }
    const swarm = await (editing() && editSwarmID()
      ? sdk.request<OpencodeXSwarm>(`/experimental/opencodex/swarm/${editSwarmID()}`, { method: "PATCH", body: JSON.stringify(payload) })
      : sdk.request<OpencodeXSwarm>("/experimental/opencodex/swarm", { method: "POST", body: JSON.stringify({ projectID: project, ...payload }) }))
      .catch((error: Error) => void DialogAlert.show(dialog, editing() ? "Edit Swarm" : "Create Swarm", error.message))
    setCreating(false)
    if (swarm) route.navigate({ type: "opencodex-swarms", swarmID: swarm.id })
  }

  useBindings(() => ({
    enabled: route.data.type === "opencodex-swarm-create" && dialog.stack.length === 0,
    commands: [
      { name: "opencodex.swarm.route.up", title: "Select previous field", category: "OpencodeX", run: () => move(-1) },
      { name: "opencodex.swarm.route.down", title: "Select next field", category: "OpencodeX", run: () => move(1) },
      { name: "opencodex.swarm.route.open", title: "Edit selected field", category: "OpencodeX", run: openSelected },
      { name: "opencodex.swarm.route.create", title: editing() ? "Save swarm" : "Create swarm", category: "OpencodeX", run: () => void saveSwarm() },
      { name: "opencodex.swarm.route.back", title: editing() ? "Cancel edit swarm" : "Cancel create swarm", category: "OpencodeX", run: cancelCreate },
      { name: "opencodex.swarm.route.dashboard", title: "Open dashboard", category: "OpencodeX", run: () => route.navigate({ type: "opencodex-dashboard" }) },
    ],
    bindings: [
      ...tuiConfig.keybinds.gather("opencodex.swarm.route", swarmRouteBindingCommands),
      { key: "up,k", desc: "Select previous field", group: "OpencodeX", cmd: () => move(-1) },
      { key: "down,j", desc: "Select next field", group: "OpencodeX", cmd: () => move(1) },
      { key: "tab", desc: "Select next field", group: "OpencodeX", cmd: ({ event }: { event: { shift: boolean } }) => move(event.shift ? -1 : 1) },
      { key: "return,space", desc: "Edit selected field", group: "OpencodeX", cmd: openSelected },
      { key: "escape", desc: "Cancel create swarm", group: "OpencodeX", cmd: cancelCreate },
    ],
  }))

  return {
    sync, route, theme, projects, projectID, title, orchestrator, roles, selectedRoles, availableRoles, editing, creating,
    promptMaxWidth, scrollAcceleration, isSelected, selectProject, editTitle, editOrchestratorName, selectModel,
    editInstructions, removeRole, addAgent, saveSwarm, cancelCreate,
  }
}
