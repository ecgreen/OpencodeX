import type { OpencodeXSwarm, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { Show, createMemo, createSignal } from "solid-js"
import {
  SWARM_ROLE_PRESETS,
  defaultSwarmRoles,
  presetRoleInput,
  roleInput,
  swarmRolePresetBySkill,
} from "../lib/swarm-actions"
import {
  readSwarmRoleTemplates,
  removeSwarmRoleTemplate,
  templateRoleInput,
  unusedSwarmRoleTemplates,
  upsertSwarmRoleTemplate,
  writeSwarmRoleTemplates,
  type SwarmRoleTemplate,
} from "../lib/swarm-role-templates"
import { SwarmEditorTeam } from "./swarm-editor-team"
import { SwarmPageHeader } from "./swarm-page-header"
import { SwarmRoleModelPicker } from "./swarm-role-model-picker"
import { SwarmRoleTemplateEditor } from "./swarm-role-template-editor"
import { Button, TextInput } from "./ui"

/** What the template modal is editing: an existing template, or a fresh draft. */
type TemplateEditorState = { template?: SwarmRoleTemplate; initial?: { name: string; instructions: string } }

/**
 * The one swarm surface: creating, viewing, and editing are the same page.
 * A roster on the left selects a role; the detail pane edits it.
 */
export function SwarmEditorPage(props: {
  providers: Provider[]
  connectedProviderIDs: string[]
  connectProvider?: (providerID?: string) => void
  swarm?: OpencodeXSwarm
  initialProjectID?: string
  recentModels: string[]
  save: (input: { projectID?: string; title?: string; roles: OpencodeXSwarmRoleInput[]; swarmID?: string }) => void | Promise<void>
  cancel: () => void
  deleteSwarm?: (swarmID: string, title: string) => void | Promise<void>
  startSession?: (swarm: OpencodeXSwarm) => void
}) {
  const [swarmTitle, setSwarmTitle] = createSignal(props.swarm?.title ?? "")
  const [roles, setRoles] = createSignal(
    props.swarm
      ? props.swarm.roles.map((role) => roleInput({
        name: role.name,
        agent: role.agent,
        skill: role.skill,
        providerID: role.providerID,
        modelID: role.modelID,
        variant: role.variant,
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
  const ready = createMemo(() => roles().length >= 2 && configuredRoleCount() === roles().length)
  const unusedPresets = createMemo(() => {
    const used = new Set(roles().map((role) => role.skill ?? role.name.trim().toLowerCase().replace(/\s+/g, "-")))
    return SWARM_ROLE_PRESETS.filter((preset) => !used.has(preset.skill))
  })
  const [templates, setTemplates] = createSignal(readSwarmRoleTemplates())
  const [templateEditor, setTemplateEditor] = createSignal<TemplateEditorState>()
  const unusedTemplates = createMemo(() => unusedSwarmRoleTemplates(templates(), roles()))

  function saveTemplate(template: SwarmRoleTemplate) {
    const next = upsertSwarmRoleTemplate(templates(), template)
    setTemplates(next)
    writeSwarmRoleTemplates(next)
  }

  function deleteTemplate(templateID: string) {
    const next = removeSwarmRoleTemplate(templates(), templateID)
    setTemplates(next)
    writeSwarmRoleTemplates(next)
  }

  function addTemplate(templateID: string) {
    const template = templates().find((item) => item.id === templateID)
    if (!template) return
    setRoles((current) => [...current, templateRoleInput(template)])
    setSelectedIndex(roles().length - 1)
  }

  /** Turns the roster role the user is looking at into a reusable template. */
  function saveRoleAsTemplate(index: number) {
    const role = roles()[index]
    if (!role) return
    setTemplateEditor({ initial: { name: role.name, instructions: role.instructions ?? "" } })
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    setError("")
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
    try {
      await props.save({
        // A swarm is a model and needs no project; one launched from a project
        // page keeps that project as its default workspace.
        projectID: props.swarm?.projectID ?? props.initialProjectID,
        title: swarmTitle().trim() || undefined,
        roles: normalizedRoles,
        swarmID: props.swarm?.id,
      })
    } finally {
      setSaving(false)
    }
  }

  function updateRole(index: number, update: (role: OpencodeXSwarmRoleInput) => OpencodeXSwarmRoleInput) {
    setRoles((current) => current.map((role, roleIndex) => roleIndex === index ? update(role) : role))
  }

  function addPreset(skill?: string) {
    const preset = skill ? swarmRolePresetBySkill(skill) : undefined
    setRoles((current) => [
      ...current,
      // A blank role carries no skill: "specialist" resolved to nothing in the
      // skill registry, so it was a dangling slug, not a base prompt.
      preset ? presetRoleInput(preset) : roleInput({ name: `Specialist ${current.length}` }),
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
        templates={unusedTemplates()}
        addTemplate={addTemplate}
        editTemplate={(template) => setTemplateEditor({ template })}
        saveRoleAsTemplate={saveRoleAsTemplate}
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
              : `${configuredRoleCount()} of ${roles().length} roles have a model`}
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
      <Show when={templateEditor()}>
        {(state) => (
          <SwarmRoleTemplateEditor
            template={state().template}
            initial={state().initial}
            save={saveTemplate}
            remove={deleteTemplate}
            close={() => setTemplateEditor(undefined)}
          />
        )}
      </Show>
      <Show when={modelPickerIndex() !== undefined}>
        <SwarmRoleModelPicker
          providers={props.providers}
          connectedProviderIDs={props.connectedProviderIDs}
          recentModels={props.recentModels}
          selectedModel={roleModelValue(roles()[modelPickerIndex()!])}
          // A variant belongs to the model it was picked for; changing the
          // model resets the effort to that model's default.
          select={(providerID, modelID) => updateRole(modelPickerIndex()!, (current) => ({ ...current, providerID, modelID, variant: undefined }))}
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
