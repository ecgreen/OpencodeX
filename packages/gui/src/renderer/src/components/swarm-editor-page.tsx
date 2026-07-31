import type { OpencodeXSwarm, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { Show, createMemo, createSignal } from "solid-js"
import {
  SWARM_ROLE_PRESETS,
  defaultSwarmRoles,
  presetRoleInput,
  roleInput,
  swarmRolePresetBySkill,
} from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/session-api"
import { SwarmEditorTeam } from "./swarm-editor-team"
import { SwarmPageHeader } from "./swarm-page-header"
import { SwarmRoleModelPicker } from "./swarm-role-model-picker"
import { Button, TextInput } from "./ui"

/**
 * The one swarm surface: creating, viewing, and editing are the same page.
 * A roster on the left selects a role; the detail pane edits it.
 */
export function SwarmEditorPage(props: {
  projects: GuiSnapshot["projects"]
  providers: Provider[]
  connectedProviderIDs: string[]
  connectProvider?: (providerID?: string) => void
  swarm?: OpencodeXSwarm
  initialProjectID?: string
  recentModels: string[]
  save: (input: { projectID: string; title?: string; roles: OpencodeXSwarmRoleInput[]; swarmID?: string }) => void | Promise<void>
  cancel: () => void
  deleteSwarm?: (swarmID: string, title: string) => void | Promise<void>
  startSession?: (swarm: OpencodeXSwarm) => void
}) {
  // A swarm is a team definition, not a per-project artifact, so no project is
  // asked for. The backend still records one; it resolves silently: the swarm's
  // own, else the project the editor was opened from, else the first project.
  const projectID = createMemo(
    () => props.swarm?.projectID ?? props.initialProjectID ?? props.projects[0]?.id ?? "",
  )
  const [swarmTitle, setSwarmTitle] = createSignal(props.swarm?.title ?? "")
  const [roles, setRoles] = createSignal<OpencodeXSwarmRoleInput[]>(
    props.swarm
      ? props.swarm.roles.map((role) => roleInput({
        name: role.name,
        agent: role.agent,
        skill: role.skill,
        providerID: role.providerID,
        modelID: role.modelID,
        modelProfile: role.modelProfile,
        instructions: role.instructions,
        metadata: role.metadata,
      }))
      : defaultSwarmRoles(),
  )
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [modelPickerIndex, setModelPickerIndex] = createSignal<number>()
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const editing = createMemo(() => props.swarm !== undefined)
  const configuredRoleCount = createMemo(() => roles().filter((role) => role.providerID && role.modelID).length)
  const ready = createMemo(() => roles().length >= 2 && configuredRoleCount() === roles().length && Boolean(projectID()))
  const unusedPresets = createMemo(() => {
    const used = new Set(roles().map((role) => role.skill ?? role.name.trim().toLowerCase().replace(/\s+/g, "-")))
    return SWARM_ROLE_PRESETS.filter((preset) => !used.has(preset.skill))
  })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    setError("")
    if (!projectID()) {
      setError("Create an OpencodeX project first.")
      return
    }
    const normalizedRoles = roles().map(roleInput)
    if (normalizedRoles.length < 2) {
      setError("Add at least one specialist beside the orchestrator.")
      return
    }
    if (normalizedRoles.some((role) => !role.providerID || !role.modelID)) {
      setError("Every role needs a model. Roles marked \"Needs model\" are missing one.")
      return
    }
    setSaving(true)
    await props.save({
      projectID: projectID(),
      title: swarmTitle().trim() || undefined,
      roles: normalizedRoles,
      swarmID: props.swarm?.id,
    })
    setSaving(false)
  }

  function updateRole(index: number, update: (role: OpencodeXSwarmRoleInput) => OpencodeXSwarmRoleInput) {
    setRoles((current) => current.map((role, roleIndex) => roleIndex === index ? update(role) : role))
  }

  function addPreset(skill?: string) {
    const preset = skill ? swarmRolePresetBySkill(skill) : undefined
    setRoles((current) => [
      ...current,
      preset ? presetRoleInput(preset) : roleInput({ name: `Specialist ${current.length}`, skill: "specialist" }),
    ])
    // The new role still needs a model, so it becomes the roster selection.
    setSelectedIndex(roles().length - 1)
  }

  function removeRole(index: number) {
    if (index === 0) return
    setSelectedIndex((current) => (current >= index ? Math.max(0, current - 1) : current))
    setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
  }

  return (
    <form class="page swarm-editor-page" onSubmit={save}>
      <SwarmPageHeader
        title={editing() ? "Edit Swarm" : "Create Swarm"}
        description="A swarm is an agent team you use like a model: pick it in the composer's model selector and the orchestrator runs your session, delegating specialists you can follow from the session's team view."
        actions={[
          ...(editing() && props.startSession
            ? [{ label: "New session", icon: "send", onClick: () => props.startSession!(props.swarm!) }]
            : []),
          ...(editing() && props.deleteSwarm
            ? [{ label: "Delete", icon: "trash", danger: true, onClick: () => props.deleteSwarm!(props.swarm!.id, props.swarm!.title) }]
            : []),
        ]}
      />
      <Show when={props.projects.length > 0} fallback={<div class="empty">Create an OpencodeX project before starting a swarm.</div>}>
        <div class="swarm-editor-basics">
          <label class="swarm-editor-field swarm-editor-title">
            <span>Name</span>
            <TextInput value={swarmTitle()} onInput={(event) => setSwarmTitle(event.currentTarget.value)} placeholder="e.g. Feature Team, Bug Triage, Release Crew" />
          </label>
        </div>
        <SwarmEditorTeam
          roles={roles()}
          providers={props.providers}
          connectedProviderIDs={props.connectedProviderIDs}
          selectedIndex={Math.min(selectedIndex(), roles().length - 1)}
          select={setSelectedIndex}
          update={updateRole}
          remove={removeRole}
          addPreset={addPreset}
          unusedPresets={unusedPresets()}
          openModelPicker={setModelPickerIndex}
        />
        <Show when={error()}>
          <div class="notice error">{error()}</div>
        </Show>
        <footer class="swarm-editor-actions">
          <Show when={!ready()} fallback={<span />}>
            <span class="swarm-editor-status">
              {roles().length < 2
                ? "Add at least one specialist"
                : configuredRoleCount() < roles().length
                  ? `${configuredRoleCount()} of ${roles().length} roles have a model`
                  : "Create an OpencodeX project first"}
            </span>
          </Show>
          <div>
            <Button icon="x" type="button" onClick={props.cancel}>{editing() ? "Close" : "Cancel"}</Button>
            <Button
              type="submit"
              appearance="solid"
              tone="accent"
              icon="check"
              disabled={saving() || !ready()}
              title={ready() ? undefined : "Every role needs a model before the swarm can be saved"}
            >
              {saving() ? "Saving..." : editing() ? "Save swarm" : "Create swarm"}
            </Button>
          </div>
        </footer>
      </Show>
      <Show when={modelPickerIndex() !== undefined}>
        <SwarmRoleModelPicker
          providers={props.providers}
          connectedProviderIDs={props.connectedProviderIDs}
          recentModels={props.recentModels}
          selectedModel={roleModelValue(roles()[modelPickerIndex()!])}
          select={(providerID, modelID) => updateRole(modelPickerIndex()!, (current) => ({ ...current, providerID, modelID }))}
          close={() => setModelPickerIndex(undefined)}
          connectProvider={props.connectProvider}
        />
      </Show>
    </form>
  )
}

function roleModelValue(role?: OpencodeXSwarmRoleInput) {
  return role?.providerID && role.modelID ? `${role.providerID}/${role.modelID}` : ""
}
