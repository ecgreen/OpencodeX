import type { Agent, OpencodeXSwarm, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { formatRelative, title } from "../lib/format"
import { modelPickerOptions, modelValue, parseModelValue } from "../lib/model-selection"
import {
  defaultSwarmRoles,
  isActiveSwarmStatus,
  nextSwarmRolePreset,
  numericTime,
  presetRoleInput,
  projectLabel,
  projectLabelByID,
  roleInput,
  swarmRolePresetBySkill,
  SWARM_ROLE_PRESET_OPTIONS,
  swarmDisplayPrompt,
  swarmDisplayStatus,
  swarmDisplayTimeUpdated,
  swarmRunSessionID,
  swarmRuns,
} from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"
import { Button, IconButton, TextArea, TextInput } from "./ui"

export function SwarmsPage(props: {
  snapshot?: GuiSnapshot
  swarmID?: string
  openSwarm: (swarmID: string) => void
  createSwarm: () => void
  editSwarm: (swarmID: string) => void
  openSession: (sessionID: string) => void
  assignTask: (swarmID: string, prompt: string) => void | Promise<void>
  cancelSwarm: (swarmID: string) => void | Promise<void>
  deleteSwarm: (swarmID: string, title: string) => void | Promise<void>
  refresh: () => void | Promise<void>
}) {
  const swarms = createMemo(() => props.snapshot?.swarms ?? [])
  const selected = createMemo(() => (props.snapshot?.swarms ?? []).find((swarm) => swarm.id === props.swarmID))
  const active = createMemo(() => swarms()
    .filter((swarm) => isActiveSwarmStatus(swarmDisplayStatus(swarm, props.snapshot)))
    .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a)))
  const inactive = createMemo(() => swarms()
    .filter((swarm) => !isActiveSwarmStatus(swarmDisplayStatus(swarm, props.snapshot)))
    .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a)))

  return (
    <div class="page swarms-page">
      <Show
        when={selected()}
        fallback={
          <>
            <PageHeader
              eyebrow="Swarms"
              title="Swarm workspace"
              description="Create reusable agent teams, assign tasks, and inspect active or completed runs."
              actions={[
                { label: "Refresh", icon: "activity", onClick: props.refresh },
                { label: "Create", icon: "plus", onClick: props.createSwarm },
              ]}
            />
            <Show
              when={swarms().length > 0}
              fallback={<EmptySwarmCard createSwarm={props.createSwarm} />}
            >
              <SwarmListSection title="Active swarms" swarms={active()} snapshot={props.snapshot} openSwarm={props.openSwarm} />
              <SwarmListSection title="Inactive swarms" swarms={inactive()} snapshot={props.snapshot} openSwarm={props.openSwarm} />
            </Show>
          </>
        }
      >
        {(swarm) => (
          <SwarmDetail
            swarm={swarm()}
            snapshot={props.snapshot}
            editSwarm={props.editSwarm}
            openSession={props.openSession}
            assignTask={props.assignTask}
            cancelSwarm={props.cancelSwarm}
            deleteSwarm={props.deleteSwarm}
            refresh={props.refresh}
          />
        )}
      </Show>
    </div>
  )
}

export function SwarmEditorPage(props: {
  projects: GuiSnapshot["projects"]
  providers: Provider[]
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
  const models = createMemo(() => modelPickerOptions(props.providers))
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

  return (
    <form class="page swarm-editor-page" onSubmit={save}>
      <PageHeader
        eyebrow={editing() ? "Edit swarm" : "Create swarm"}
        title={editing() ? props.swarm?.title ?? "Edit swarm" : "Create swarm"}
        description="Configure the orchestrator first, then add specialist roles with their own skills, models, and optional custom instructions."
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
                        <span>Model</span>
                        <select value={role.providerID && role.modelID ? modelValue(role.providerID, role.modelID) : ""} onChange={(event) => {
                          const model = parseModelValue(event.currentTarget.value)
                          updateRole(index(), (current) => ({ ...current, providerID: model?.providerID, modelID: model?.modelID }))
                        }}>
                          <option value="">Select model</option>
                          <For each={models()}>
                            {(option) => <option value={modelValue(option.provider.id, option.model.id)}>{option.provider.name} / {option.model.name ?? option.model.id}</option>}
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

function SwarmDetail(props: {
  swarm: OpencodeXSwarm
  snapshot?: GuiSnapshot
  editSwarm: (swarmID: string) => void
  openSession: (sessionID: string) => void
  assignTask: (swarmID: string, prompt: string) => void | Promise<void>
  cancelSwarm: (swarmID: string) => void | Promise<void>
  deleteSwarm: (swarmID: string, title: string) => void | Promise<void>
  refresh: () => void | Promise<void>
}) {
  const [taskPrompt, setTaskPrompt] = createSignal("")
  const status = createMemo(() => swarmDisplayStatus(props.swarm, props.snapshot))
  const runs = createMemo(() => swarmRuns(props.swarm))
  async function submitTask(event: SubmitEvent) {
    event.preventDefault()
    const prompt = taskPrompt().trim()
    if (!prompt) return
    await props.assignTask(props.swarm.id, prompt)
    setTaskPrompt("")
  }
  return (
    <>
      <PageHeader
        eyebrow="Swarm"
        title={props.swarm.title}
        description={`${projectLabelByID(props.snapshot?.projects ?? [], props.swarm.projectID)} - ${props.swarm.roles.length} roles - ${runs().length} tasks`}
        actions={[
          { label: "Refresh", icon: "activity", onClick: props.refresh },
          { label: "Edit", icon: "settings", onClick: () => props.editSwarm(props.swarm.id) },
          ...(isActiveSwarmStatus(status()) ? [{ label: "Cancel", icon: "stop", onClick: () => props.cancelSwarm(props.swarm.id) }] : []),
          { label: "Delete", icon: "trash", danger: true, onClick: () => props.deleteSwarm(props.swarm.id, props.swarm.title) },
        ]}
      />
      <section class="swarm-detail-grid">
        <article class={`dashboard-item-card dashboard-status-card status-${status().replaceAll("_", "-")}`}>
          <div>
            <strong>{status()}</strong>
            <span>{swarmDisplayPrompt(props.swarm) || "No tasks yet."}</span>
          </div>
          <footer><small>{formatRelative(swarmDisplayTimeUpdated(props.swarm))}</small></footer>
        </article>
        <form class="dashboard-item-card swarm-task-card" onSubmit={submitTask}>
          <strong>New task</strong>
          <TextArea value={taskPrompt()} onInput={(event) => setTaskPrompt(event.currentTarget.value)} placeholder="Describe the next task for this swarm" />
          <Button type="submit" variant="primary" icon="send">Assign task</Button>
        </form>
      </section>
      <section class="manager-section">
        <header>
          <strong>Team</strong>
          <span>{props.swarm.roles.length} roles</span>
        </header>
        <div class="dashboard-card-grid">
          <For each={props.swarm.roles} fallback={<div class="empty">No roles assigned to this swarm.</div>}>
            {(role, index) => (
              <article class="dashboard-item-card">
                <div>
                  <strong>{role.name}</strong>
                  <span>{index() === 0 ? "Orchestrator" : role.skill ?? role.agent ?? "Specialist"}</span>
                </div>
                <footer>
                  <small>{[role.providerID, role.modelID].filter(Boolean).join("/") || "No model"}</small>
                </footer>
              </article>
            )}
          </For>
        </div>
      </section>
      <section class="manager-section">
        <header>
          <strong>Tasks</strong>
          <span>{runs().length} runs</span>
        </header>
        <div class="dashboard-card-grid">
          <For each={runs()} fallback={<div class="empty">No tasks assigned yet.</div>}>
            {(run) => {
              const sessionID = createMemo(() => swarmRunSessionID(run))
              return (
                <button class="dashboard-item-card interactive" disabled={!sessionID()} onClick={() => sessionID() ? props.openSession(sessionID()!) : undefined}>
                  <div>
                    <strong>{title(run.title || run.prompt || "Swarm task")}</strong>
                    <span>{run.status}</span>
                  </div>
                  <footer>
                    <small>{formatRelative(numericTime(run.timeUpdated))} - {run.agents.length} agents</small>
                  </footer>
                </button>
              )
            }}
          </For>
        </div>
      </section>
    </>
  )
}

function SwarmListSection(props: {
  title: string
  swarms: OpencodeXSwarm[]
  snapshot?: GuiSnapshot
  openSwarm: (swarmID: string) => void
}) {
  return (
    <section class="manager-section">
      <header>
        <strong>{props.title}</strong>
        <span>{props.swarms.length}</span>
      </header>
      <div class="dashboard-card-grid">
        <For each={props.swarms} fallback={<div class="empty">No {props.title.toLowerCase()}.</div>}>
          {(swarm) => (
            <button class={`dashboard-item-card dashboard-status-card interactive status-${swarmDisplayStatus(swarm, props.snapshot).replaceAll("_", "-")}`} onClick={() => props.openSwarm(swarm.id)}>
              <div>
                <strong>{title(swarm.title)}</strong>
                <span>{projectLabelByID(props.snapshot?.projects ?? [], swarm.projectID)} - {swarm.roles.length} roles - {swarm.runs.length} runs</span>
              </div>
              <footer>
                <small>{swarmDisplayStatus(swarm, props.snapshot)} - {formatRelative(swarmDisplayTimeUpdated(swarm))}</small>
              </footer>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}

function EmptySwarmCard(props: { createSwarm: () => void }) {
  return (
    <button class="dashboard-item-card empty-create interactive" onClick={props.createSwarm}>
      <strong>+ Create swarm</strong>
      <span>Build a reusable agent team.</span>
      <small>create</small>
    </button>
  )
}

function PageHeader(props: {
  eyebrow: string
  title: string
  description: string
  actions: Array<{ label: string; icon: string; danger?: boolean; onClick: () => void | Promise<void> }>
}) {
  return (
    <header class="manager-page-header">
      <div>
        <p class="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      <div class="row-actions">
        <For each={props.actions}>
          {(action) => <Button variant={action.danger ? "danger" : "secondary"} icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
        </For>
      </div>
    </header>
  )
}
