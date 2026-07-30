import type { OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import {
  SWARM_ROLE_PRESET_OPTIONS,
  isCustomizedSwarmRoleName,
  swarmRolePresetBySkill,
  type SwarmRolePreset,
} from "../lib/swarm-actions"
import type { SwarmRoleTemplate } from "../lib/swarm-role-templates"
import { Icon } from "./icon"
import { Button, IconButton, Select, TextArea, TextInput } from "./ui"

type SkillChoice = { id: string; label: string }

/**
 * Roster on the left, one role's details on the right. The orchestrator is
 * pinned first; specialists come and go beneath it.
 */
export function SwarmEditorTeam(props: {
  roles: OpencodeXSwarmRoleInput[]
  providers: Provider[]
  connectedProviderIDs: string[]
  selectedIndex: number
  select: (index: number) => void
  update: (index: number, update: (role: OpencodeXSwarmRoleInput) => OpencodeXSwarmRoleInput) => void
  remove: (index: number) => void
  addPreset: (skill?: string) => void
  unusedPresets: SwarmRolePreset[]
  templates: SwarmRoleTemplate[]
  addTemplate: (templateID: string) => void
  editTemplate: (template: SwarmRoleTemplate) => void
  saveRoleAsTemplate: (index: number) => void
  openModelPicker: (index: number) => void
}) {
  const selected = createMemo(() => props.roles[props.selectedIndex])
  // One array per state: Kobalte's Select requires `current` to be an element
  // of `options` (reference equality), or it re-syncs forever.
  const selectedSkillChoices = createMemo(() => skillChoices(selected()?.skill))
  const selectedSkillChoice = createMemo(() =>
    selectedSkillChoices().find((choice) => choice.id === selected()?.skill),
  )
  const modelSummary = (role: OpencodeXSwarmRoleInput) => {
    if (!role.providerID || !role.modelID) return undefined
    const provider = props.providers.find((item) => item.id === role.providerID)
    const model = provider?.models[role.modelID]
    return { model: model?.name ?? role.modelID, provider: provider?.name ?? role.providerID }
  }
  const providerDisconnected = (role: OpencodeXSwarmRoleInput) =>
    Boolean(role.providerID) && !props.connectedProviderIDs.includes(role.providerID!)

  function updateSkill(index: number, skill: string) {
    const preset = swarmRolePresetBySkill(skill)
    props.update(index, (current) => ({
      ...current,
      // The preset name fills a default; a name the user wrote stays theirs.
      name: preset && !isCustomizedSwarmRoleName(current.name) ? preset.name : current.name,
      skill: skill || undefined,
    }))
  }

  function skillChoices(skill?: string): SkillChoice[] {
    const choices = SWARM_ROLE_PRESET_OPTIONS.map((preset) => ({ id: preset.skill, label: preset.name }))
    if (!skill || choices.some((choice) => choice.id === skill)) return choices
    return [{ id: skill, label: skill }, ...choices]
  }

  return (
    <section class="swarm-editor-team">
      <header class="swarm-editor-team-header">
        <h2>Team</h2>
        <span>{props.roles.length === 1 ? "The orchestrator leads; add specialists beside it." : `${props.roles.length} roles`}</span>
      </header>
      <div class="swarm-editor-team-grid">
      <aside class="swarm-roster">
        <div class="swarm-roster-list" role="tablist" aria-label="Swarm roles">
          <For each={props.roles}>
            {(role, index) => (
              <Button
                appearance="ghost"
                class="swarm-roster-row"
                role="tab"
                aria-selected={props.selectedIndex === index()}
                classList={{ selected: props.selectedIndex === index(), unconfigured: !role.providerID || !role.modelID }}
                onClick={() => props.select(index())}
              >
                <span class="swarm-role-index">{index() === 0 ? <Icon name="swarm" /> : index()}</span>
                <span class="swarm-roster-copy">
                  <strong>{role.name || (index() === 0 ? "Orchestrator" : `Specialist ${index()}`)}</strong>
                  <small>{modelSummary(role) ? modelSummary(role)!.model : "Needs model"}</small>
                </span>
                <Show when={!role.providerID || !role.modelID}>
                  <span class="swarm-roster-warning" title="This role has no model yet" />
                </Show>
              </Button>
            )}
          </For>
        </div>
        <div class="swarm-roster-add">
          <span>Add a role</span>
          <div class="swarm-roster-add-list">
            <For each={props.unusedPresets}>
              {(preset) => (
                <Button appearance="ghost" class="swarm-roster-add-row" type="button" onClick={() => props.addPreset(preset.skill)}>
                  <span class="swarm-roster-add-copy">
                    <strong><Icon name="plus" />{preset.name}</strong>
                    <small>{preset.description}</small>
                  </span>
                </Button>
              )}
            </For>
            <Button appearance="ghost" class="swarm-roster-add-row" type="button" onClick={() => props.addPreset()}>
              <span class="swarm-roster-add-copy">
                <strong><Icon name="plus" />Custom role</strong>
                <small>Start from a blank specialist, then "Save as role" to reuse it.</small>
              </span>
            </Button>
          </div>
          <Show when={props.templates.length > 0}>
            <span>Your roles</span>
            <div class="swarm-roster-add-list">
              <For each={props.templates}>
                {(template) => (
                  <div class="swarm-roster-template-row">
                    <Button appearance="ghost" class="swarm-roster-add-row" type="button" onClick={() => props.addTemplate(template.id)}>
                      <span class="swarm-roster-add-copy">
                        <strong><Icon name="plus" />{template.name}</strong>
                        <small>{template.description || template.instructions}</small>
                      </span>
                    </Button>
                    <IconButton
                      appearance="ghost"
                      size="compact"
                      icon="pencil"
                      label={`Edit the ${template.name} role`}
                      onClick={() => props.editTemplate(template)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </aside>
      <Show when={selected()}>
        {(role) => (
          <div class="swarm-role-detail" classList={{ orchestrator: props.selectedIndex === 0 }}>
            <header>
              <div>
                <strong>{role().name || (props.selectedIndex === 0 ? "Orchestrator" : `Specialist ${props.selectedIndex}`)}</strong>
                <span>
                  {props.selectedIndex === 0
                    ? "Leads the session, talks to you, and delegates the team"
                    : swarmRolePresetBySkill(role().skill)?.description ?? "Specialist role"}
                </span>
              </div>
              <Show when={props.selectedIndex > 0}>
                <div class="swarm-role-detail-actions">
                  <Button
                    appearance="ghost"
                    size="compact"
                    icon="save"
                    type="button"
                    title="Save this role's name and instructions as a reusable role"
                    onClick={() => props.saveRoleAsTemplate(props.selectedIndex)}
                  >
                    Save as role
                  </Button>
                  <Button appearance="ghost" tone="danger" size="compact" icon="trash" type="button" onClick={() => props.remove(props.selectedIndex)}>
                    Remove
                  </Button>
                </div>
              </Show>
            </header>
            <div class="swarm-role-fields">
              <label>
                <span>Name</span>
                <TextInput
                  value={role().name}
                  onInput={(event) => props.update(props.selectedIndex, (current) => ({ ...current, name: event.currentTarget.value }))}
                />
              </label>
              <Select<SkillChoice>
                label="Skill"
                options={selectedSkillChoices()}
                current={selectedSkillChoice()}
                optionValue={(choice) => choice.id}
                optionLabel={(choice) => choice.label}
                optionDescription={(choice) => swarmRolePresetBySkill(choice.id)?.description}
                onSelect={(choice) => choice && choice.id !== role().skill && updateSkill(props.selectedIndex, choice.id)}
              />
              <div class="swarm-role-model">
                <span>Model</span>
                <Button
                  appearance="ghost"
                  class="swarm-model-button"
                  classList={{ empty: !modelSummary(role()) }}
                  onClick={() => props.openModelPicker(props.selectedIndex)}
                >
                  <Show when={modelSummary(role())} fallback={<strong>Choose model</strong>}>
                    {(summary) => (
                      <>
                        <strong>{summary().model}</strong>
                        <small>{summary().provider}</small>
                      </>
                    )}
                  </Show>
                  <Icon name="chevronRight" />
                </Button>
                <Show when={providerDisconnected(role())}>
                  <small class="swarm-model-warning">Provider not connected - prompts will fail until credentials are added.</small>
                </Show>
              </div>
              <label class="swarm-role-instructions">
                <span>Instructions <em>optional</em></span>
                <TextArea
                  value={role().instructions ?? ""}
                  placeholder={props.selectedIndex === 0 ? "How should the orchestrator run this team?" : "What should this specialist focus on?"}
                  onInput={(event) => props.update(props.selectedIndex, (current) => ({ ...current, instructions: event.currentTarget.value }))}
                />
              </label>
            </div>
          </div>
        )}
      </Show>
      </div>
    </section>
  )
}
