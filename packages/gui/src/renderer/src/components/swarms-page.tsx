import type { Agent, OpencodeXSwarm, OpencodeXSwarmRoleInput, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { formatRelative, title } from "../lib/format"
import { modelPickerOptions, modelValue, parseModelValue } from "../lib/model-selection"
import {
  defaultSwarmRoles,
  isActiveSwarmStatus,
  numericTime,
  primaryAgents,
  projectLabel,
  projectLabelByID,
  roleInput,
  swarmDisplayPrompt,
  swarmDisplayStatus,
  swarmDisplayTimeUpdated,
  swarmRunSessionID,
  swarmRuns,
} from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/store"
import { Icon } from "./icon"

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
  const selected = createMemo(() => (props.snapshot?.swarms ?? []).find((swarm) => swarm.id === props.swarmID))
  const active = createMemo(() => (props.snapshot?.swarms ?? [])
    .filter((swarm) => isActiveSwarmStatus(swarmDisplayStatus(swarm, props.snapshot)))
    .toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a)))
  const inactive = createMemo(() => (props.snapshot?.swarms ?? [])
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
            <SwarmListSection title="Active swarms" swarms={active()} snapshot={props.snapshot} openSwarm={props.openSwarm} createSwarm={props.createSwarm} />
            <SwarmListSection title="Inactive swarms" swarms={inactive()} snapshot={props.snapshot} openSwarm={props.openSwarm} createSwarm={props.createSwarm} />
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
  selectedModel: string
  save: (input: { projectID: string; title?: string; roles: OpencodeXSwarmRoleInput[]; swarmID?: string }) => void | Promise<void>
  cancel: () => void
}) {
  const initialModel = createMemo(() => parseModelValue(props.selectedModel))
  const [projectID, setProjectID] = createSignal(props.swarm?.projectID ?? props.projects[0]?.id ?? "")
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
  const agentOptions = createMemo(() => primaryAgents(props.agents))
  const editing = createMemo(() => props.swarm !== undefined)

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
    const agent = agentOptions().find((item) => !roles().some((role) => role.agent === item.name))
    setRoles((current) => [
      ...current,
      roleInput({
        name: agent ? title(agent.name) : `Specialist ${current.length}`,
        agent: agent?.name,
        skill: agent?.name ?? "specialist",
        providerID: initialModel()?.providerID ?? agent?.model?.providerID,
        modelID: initialModel()?.modelID ?? agent?.model?.modelID,
        instructions: "Handle delegated work and report concise findings.",
      }),
    ])
  }

  function removeRole(index: number) {
    if (index === 0) return
    setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
  }

  return (
    <form class="page swarm-editor-page" onSubmit={save}>
      <PageHeader
        eyebrow={editing() ? "Edit swarm" : "Create swarm"}
        title={editing() ? props.swarm?.title ?? "Edit swarm" : "Create swarm"}
        description="Configure the orchestrator first, then add specialist roles with their own agents, models, and instructions."
        actions={[{ label: "Cancel", icon: "x", onClick: props.cancel }]}
      />
      <Show when={props.projects.length > 0} fallback={<div class="empty">Create an OpencodeX project before starting a swarm.</div>}>
        <section class="manager-section">
          <header>
            <strong>Swarm</strong>
          </header>
          <div class="form-grid">
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
              <input value={swarmTitle()} onInput={(event) => setSwarmTitle(event.currentTarget.value)} placeholder="Optional; first task can name the swarm later" />
            </label>
          </div>
        </section>
        <section class="manager-section">
          <header>
            <div>
              <strong>Team</strong>
              <span>{roles().length} roles</span>
            </div>
            <button type="button" class="secondary" onClick={addRole}><Icon name="plus" /> Role</button>
          </header>
          <div class="role-editor-list">
            <For each={roles()}>
              {(role, index) => (
                <article class="role-editor-card">
                  <header>
                    <strong>{index() === 0 ? "Orchestrator" : `Specialist ${index()}`}</strong>
                    <Show when={index() > 0}>
                      <button type="button" class="danger" onClick={() => removeRole(index())}>Remove</button>
                    </Show>
                  </header>
                  <div class="form-grid">
                    <label>
                      <span>Name</span>
                      <input value={role.name} onInput={(event) => updateRole(index(), (current) => ({ ...current, name: event.currentTarget.value }))} />
                    </label>
                    <label>
                      <span>Agent</span>
                      <select value={role.agent ?? ""} onChange={(event) => updateRole(index(), (current) => ({ ...current, agent: event.currentTarget.value || undefined, skill: current.skill ?? (event.currentTarget.value || undefined) }))}>
                        <option value="">No agent binding</option>
                        <For each={agentOptions()}>
                          {(agent) => <option value={agent.name}>{title(agent.name)}</option>}
                        </For>
                      </select>
                    </label>
                    <label>
                      <span>Skill</span>
                      <input value={role.skill ?? ""} onInput={(event) => updateRole(index(), (current) => ({ ...current, skill: event.currentTarget.value || undefined }))} />
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
                  </div>
                  <label>
                    <span>Instructions</span>
                    <textarea value={role.instructions} onInput={(event) => updateRole(index(), (current) => ({ ...current, instructions: event.currentTarget.value }))} />
                  </label>
                </article>
              )}
            </For>
          </div>
        </section>
        <Show when={error()}>
          <div class="notice error">{error()}</div>
        </Show>
        <div class="form-actions">
          <button type="button" class="secondary" onClick={props.cancel}>Cancel</button>
          <button type="submit" class="primary" disabled={saving()}>{saving() ? "Saving..." : editing() ? "Save swarm" : "Create swarm"}</button>
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
          { label: "Delete", icon: "x", danger: true, onClick: () => props.deleteSwarm(props.swarm.id, props.swarm.title) },
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
          <textarea value={taskPrompt()} onInput={(event) => setTaskPrompt(event.currentTarget.value)} placeholder="Describe the next task for this swarm" />
          <button type="submit" class="primary"><Icon name="send" /> Assign task</button>
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
  createSwarm: () => void
}) {
  return (
    <section class="manager-section">
      <header>
        <strong>{props.title}</strong>
        <span>{props.swarms.length}</span>
      </header>
      <div class="dashboard-card-grid">
        <For each={props.swarms} fallback={<EmptySwarmCard createSwarm={props.createSwarm} />}>
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
          {(action) => <button class={action.danger ? "danger" : "secondary"} type="button" onClick={action.onClick}><Icon name={action.icon} /> {action.label}</button>}
        </For>
      </div>
    </header>
  )
}
