import type { OpencodeXSwarm } from "@opencode-ai/sdk/v2/client"
import { clientSwarmStatusLabel } from "@opencode-ai/sdk/v2/swarm-presentation"
import { For, Show, createMemo, createSignal } from "solid-js"
import { formatRelative, title } from "../lib/format"
import {
  isActiveSwarmStatus,
  numericTime,
  projectLabelByID,
  swarmDisplayPrompt,
  swarmDisplayStatus,
  swarmDisplayTimeUpdated,
  swarmRunSessionID,
  swarmRuns,
} from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/store"
import { SwarmPageHeader } from "./swarm-page-header"
import { Button, TextArea } from "./ui"

export { SwarmEditorPage } from "./swarm-editor-page"

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
            <SwarmPageHeader
              eyebrow="Swarms"
              title="Swarm workspace"
              description="Experimental: create reusable agent teams, assign tasks, and inspect active or completed runs."
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
      <SwarmPageHeader
        eyebrow="Swarm"
        title={props.swarm.title}
        description={`Experimental - ${projectLabelByID(props.snapshot?.projects ?? [], props.swarm.projectID)} - ${props.swarm.roles.length} roles - ${runs().length} tasks`}
        actions={[
          { label: "Refresh", icon: "activity", onClick: props.refresh },
          { label: "Edit", icon: "settings", onClick: () => props.editSwarm(props.swarm.id) },
          ...(isActiveSwarmStatus(status()) && status() !== "cancelling"
            ? [{ label: "Cancel", icon: "stop", onClick: () => props.cancelSwarm(props.swarm.id) }]
            : []),
          { label: "Delete", icon: "trash", danger: true, onClick: () => props.deleteSwarm(props.swarm.id, props.swarm.title) },
        ]}
      />
      <section class="swarm-detail-grid">
        <article class={`dashboard-item-card dashboard-status-card status-${status().replaceAll("_", "-")}`}>
          <div>
            <strong>{clientSwarmStatusLabel(status())}</strong>
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
                    <span>{clientSwarmStatusLabel(run.status)}</span>
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
                <small>{clientSwarmStatusLabel(swarmDisplayStatus(swarm, props.snapshot))} - {formatRelative(swarmDisplayTimeUpdated(swarm))}</small>
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
