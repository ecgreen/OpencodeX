import type { OpencodeXSwarm } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import { formatRelative, title } from "../lib/format"
import { projectLabelByID, swarmDisplayTimeUpdated, swarmIsWorking, swarmSessions } from "../lib/swarm-actions"
import type { GuiSnapshot } from "../lib/session-api"
import { Icon } from "./icon"
import { SwarmPageHeader } from "./swarm-page-header"
import { Button } from "./ui"

export { SwarmEditorPage } from "./swarm-editor-page"

/**
 * The swarm catalog. A swarm behaves like a model - the real "detail" view is
 * the editor, so opening a card goes straight there.
 */
export function SwarmsPage(props: {
  snapshot?: GuiSnapshot
  openSwarm: (swarmID: string) => void
  createSwarm: () => void
  startSession: (swarm: OpencodeXSwarm) => void
}) {
  const swarms = createMemo(() =>
    (props.snapshot?.swarms ?? []).toSorted((a, b) => swarmDisplayTimeUpdated(b) - swarmDisplayTimeUpdated(a)),
  )
  return (
    <div class="page swarms-page">
      <SwarmPageHeader
        title="Swarms"
        description="A swarm is a reusable agent team you use like a model: pick it in any session's model selector and the orchestrator coordinates the specialists for you."
        actions={[{ label: "New swarm", icon: "plus", onClick: props.createSwarm }]}
      />
      <Show when={swarms().length > 0} fallback={<SwarmEmptyState createSwarm={props.createSwarm} />}>
        <div class="swarm-card-grid">
          <For each={swarms()}>
            {(swarm) => (
              <SwarmCard
                swarm={swarm}
                snapshot={props.snapshot}
                openSwarm={props.openSwarm}
                startSession={props.startSession}
              />
            )}
          </For>
          <Button appearance="ghost" class="swarm-create-card" onClick={props.createSwarm}>
            <Icon name="plus" />
            <strong>New swarm</strong>
            <span>Assemble another agent team</span>
          </Button>
        </div>
      </Show>
    </div>
  )
}

function SwarmCard(props: {
  swarm: OpencodeXSwarm
  snapshot?: GuiSnapshot
  openSwarm: (swarmID: string) => void
  startSession: (swarm: OpencodeXSwarm) => void
}) {
  const working = createMemo(() => swarmIsWorking(props.swarm, props.snapshot))
  const sessions = createMemo(() => swarmSessions(props.snapshot?.sessions ?? [], props.swarm.id))
  const orchestrator = () => props.swarm.roles[0]
  return (
    <article class="swarm-card" classList={{ working: working() }}>
      <Button appearance="ghost" class="swarm-card-open" onClick={() => props.openSwarm(props.swarm.id)}>
        <header>
          <span class="swarm-option-icon"><Icon name="swarm" /></span>
          <strong>{title(props.swarm.title)}</strong>
          <span class="swarm-status-dot" title={working() ? "Working" : "Idle"} />
        </header>
        <div class="swarm-card-roles">
          <For each={props.swarm.roles.slice(0, 5)}>
            {(role, index) => <span classList={{ orchestrator: index() === 0 }}>{role.name}</span>}
          </For>
          <Show when={props.swarm.roles.length > 5}>
            <span>+{props.swarm.roles.length - 5}</span>
          </Show>
        </div>
        <div class="swarm-card-meta">
          <small>{projectLabelByID(props.snapshot?.projects ?? [], props.swarm.projectID)}</small>
          <small>
            {orchestrator()?.modelID ? `Led by ${orchestrator()?.modelID}` : "Orchestrator needs a model"}
            {" · "}
            {sessions().length > 0 ? `${sessions().length} session${sessions().length === 1 ? "" : "s"}` : "No sessions yet"}
            {" · "}
            {formatRelative(swarmDisplayTimeUpdated(props.swarm))}
          </small>
        </div>
      </Button>
      <footer>
        <Button appearance="outline" size="compact" icon="send" onClick={() => props.startSession(props.swarm)}>
          New session
        </Button>
        <Button appearance="ghost" size="compact" icon="settings" onClick={() => props.openSwarm(props.swarm.id)}>
          Configure
        </Button>
      </footer>
    </article>
  )
}

function SwarmEmptyState(props: { createSwarm: () => void }) {
  return (
    <div class="swarm-empty-state">
      <span class="swarm-option-icon"><Icon name="swarm" /></span>
      <h3>Build your first agent team</h3>
      <p>A swarm pairs an orchestrator with specialist roles, each on its own model. Once created, it shows up in the model selector like any other model.</p>
      <Button appearance="solid" tone="accent" icon="plus" onClick={props.createSwarm}>Create swarm</Button>
    </div>
  )
}
