import type { Agent, OpencodeXSwarm, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { modelPickerOptions, modelPickerProviders, parseModelValue } from "../lib/model-selection"
import {
  defaultSwarmRoles,
  nextSwarmRolePreset,
  presetRoleInput,
  projectLabel,
  projectLabelByID,
  roleInput,
  swarmProviderSelectionKey,
  swarmRolePresetBySkill,
  SWARM_ROLE_PRESET_OPTIONS,
} from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { SwarmPageHeader } from "./swarm-page-header"
import { Button, IconButton, TextArea, TextInput } from "./ui"

export function SwarmEditorPage(props: {
  projects: GuiSnapshot["projects"]
  providers: Provider[]
  connectedProviderIDs: string[]
  agents: Agent[]
  swarm?: OpencodeXSwarm
  initialProjectID?: string
  selectedModel: string
  save: (input: { projectID: string; title?: string; roles: OpencodeXSwarmRoleInput[]; swarmID?: string }) => void | Promise<void>
  cancel: () => void
}) {
  const initialModel = createMemo(() => parseModelValue(props.selectedModel))
  const [projectID, setProjectID] = createSignal(props.swarm?.projectID ?? props.initialProjectID ?? props.projects[0]?.id ?? "")
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
      : defaultSwarmRoles({
        agents: props.agents,
        providerID: initialModel()?.providerID,
        modelID: initialModel()?.modelID,
      }),
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const selectedProviderKey = createMemo(() => swarmProviderSelectionKey(roles()))
  const modelProviders = createMemo(() =>
    modelPickerProviders(
      props.providers,
      props.connectedProviderIDs,
      selectedProviderKey() ? selectedProviderKey().split("\0") : [],
    ),
  )
  const editing = createMemo(() => props.swarm !== undefined)
  const selectedProjectName = createMemo(() => projectLabelByID(props.projects, projectID()))
  const configuredRoleCount = createMemo(() => roles().filter((role) => role.providerID && role.modelID).length)

  async function save(event: SubmitEvent) {
    event.preventDefault()
    setError("")
    if (!projectID()) {
      setError("Select an OpencodeX project first.")
      return
    }
    const normalizedRoles = roles().map(roleInput)
    if (normalizedRoles.length < 2) {
      setError("Add an orchestrator and at least one specialist role.")
      return
    }
    if (normalizedRoles.some((role) => !role.providerID || !role.modelID)) {
      setError("Select a model for every role.")
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

  function addRole() {
    const preset = nextSwarmRolePreset(roles())
    setRoles((current) => [
      ...current,
      preset
        ? presetRoleInput(preset, {
          providerID: initialModel()?.providerID,
          modelID: initialModel()?.modelID,
        })
        : roleInput({
          name: `Specialist ${current.length}`,
          skill: "specialist",
          providerID: initialModel()?.providerID,
          modelID: initialModel()?.modelID,
        }),
    ])
  }

  function removeRole(index: number) {
    if (index === 0) return
    setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
  }

  function updateRoleSkill(index: number, skill: string) {
    const preset = swarmRolePresetBySkill(skill)
    updateRole(index, (current) => roleInput({
      ...current,
      name: preset?.name ?? current.name,
      skill: skill || undefined,
      instructions: current.instructions,
    }))
  }

  function roleModels(providerID?: string) {
    if (!providerID) return []
    return modelPickerOptions(modelProviders().filter((provider) => provider.id === providerID))
  }

  return (
    <form class="page swarm-editor-page" onSubmit={save}>
      <SwarmPageHeader
        eyebrow={editing() ? "Edit swarm" : "Create swarm"}
        title={editing() ? props.swarm?.title ?? "Edit swarm" : "Create swarm"}
        description="Experimental: configure the orchestrator first, then add specialist roles with their own skills, models, and optional custom instructions."
        actions={[{ label: "Cancel", icon: "x", onClick: props.cancel }]}
      />
      <Show when={props.projects.length > 0} fallback={<div class="empty">Create an OpencodeX project before starting a swarm.</div>}>
        <div class="swarm-editor-layout">
          <aside class="swarm-editor-sidebar">
            <section class="swarm-editor-panel">
              <header>
                <span><Icon name="swarm" /></span>
                <div>
                  <strong>Basics</strong>
                  <small>{editing() ? "Existing swarm" : "New swarm"}</small>
                </div>
              </header>
              <div class="swarm-editor-fields">
                <label>
                  <span>Project</span>
                  <select value={projectID()} disabled={editing()} onChange={(event) => setProjectID(event.currentTarget.value)}>
                    <For each={props.projects}>
                      {(project) => <option value={project.id}>{projectLabel(project)}</option>}
                    </For>
                  </select>
                </label>
                <label>
                  <span>Title</span>
                  <TextInput value={swarmTitle()} onInput={(event) => setSwarmTitle(event.currentTarget.value)} placeholder="Optional; first task can name the swarm later" />
                </label>
              </div>
            </section>
            <section class="swarm-editor-panel swarm-editor-summary">
              <header>
                <span><Icon name="activity" /></span>
                <div>
                  <strong>Summary</strong>
                  <small>{configuredRoleCount()} of {roles().length} roles configured</small>
                </div>
              </header>
              <dl>
                <div>
                  <dt>Project</dt>
                  <dd>{selectedProjectName()}</dd>
                </div>
                <div>
                  <dt>Roles</dt>
                  <dd>{roles().length}</dd>
                </div>
                <div>
                  <dt>Models</dt>
                  <dd>{configuredRoleCount()} ready</dd>
                </div>
              </dl>
            </section>
          </aside>
          <section class="swarm-editor-team">
            <header>
              <div>
                <strong>Team setup</strong>
                <span>{roles().length} roles</span>
              </div>
              <Button size="sm" icon="plus" onClick={addRole}>Add role</Button>
            </header>
            <div class="role-editor-list">
              <For each={roles()}>
                {(role, index) => (
                  <article class="role-editor-card swarm-role-card">
                    <header>
                      <div>
                        <span class="swarm-role-index">{index() + 1}</span>
                        <div>
                          <strong>{role.name || (index() === 0 ? "Orchestrator" : `Specialist ${index()}`)}</strong>
                          <span>{index() === 0 ? "Orchestrator" : "Specialist"} - {role.skill ?? "No skill"} - {role.providerID && role.modelID ? "Model selected" : "Needs model"}</span>
                        </div>
                      </div>
                      <Show when={index() > 0}>
                        <IconButton variant="danger" icon="trash" label={`Remove role ${index()}`} onClick={() => removeRole(index())} />
                      </Show>
                    </header>
                    <div class="swarm-role-fields">
                      <label>
                        <span>Name</span>
                        <TextInput value={role.name} onInput={(event) => updateRole(index(), (current) => ({ ...current, name: event.currentTarget.value }))} />
                      </label>
                      <label>
                        <span>Skill</span>
                        <select value={role.skill ?? ""} onChange={(event) => updateRoleSkill(index(), event.currentTarget.value)}>
                          <Show when={role.skill && !swarmRolePresetBySkill(role.skill)}>
                            <option value={role.skill}>{role.skill}</option>
                          </Show>
                          <For each={SWARM_ROLE_PRESET_OPTIONS}>
                            {(preset) => <option value={preset.skill}>{preset.name}</option>}
                          </For>
                        </select>
                      </label>
                      <label>
                        <span>Provider</span>
                        <select value={role.providerID ?? ""} onChange={(event) => {
                          const providerID = event.currentTarget.value || undefined
                          updateRole(index(), (current) => ({ ...current, providerID, modelID: undefined }))
                        }}>
                          <option value="">Select provider</option>
                          <For each={modelProviders()}>
                            {(provider) => <option value={provider.id}>{provider.name}</option>}
                          </For>
                        </select>
                      </label>
                      <label>
                        <span>Model</span>
                        <select disabled={!role.providerID} value={role.modelID ?? ""} onChange={(event) => {
                          const modelID = event.currentTarget.value || undefined
                          updateRole(index(), (current) => ({ ...current, modelID }))
                        }}>
                          <option value="">Select model</option>
                          <Show when={role.providerID && role.modelID && !roleModels(role.providerID).some((option) => option.model.id === role.modelID)}>
                            <option value={role.modelID}>{role.modelID} (unavailable)</option>
                          </Show>
                          <For each={roleModels(role.providerID)}>
                            {(option) => <option value={option.model.id}>{option.model.name ?? option.model.id}</option>}
                          </For>
                        </select>
                      </label>
                      <label class="swarm-role-instructions">
                        <span>Instructions</span>
                        <TextArea value={role.instructions ?? ""} onInput={(event) => updateRole(index(), (current) => ({ ...current, instructions: event.currentTarget.value }))} />
                      </label>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </section>
        </div>
        <Show when={error()}>
          <div class="notice error">{error()}</div>
        </Show>
        <div class="form-actions swarm-editor-actions">
          <Button icon="x" onClick={props.cancel}>Cancel</Button>
          <Button type="submit" variant="primary" icon="check" disabled={saving()}>{saving() ? "Saving..." : editing() ? "Save swarm" : "Create swarm"}</Button>
        </div>
      </Show>
    </form>
  )
}
