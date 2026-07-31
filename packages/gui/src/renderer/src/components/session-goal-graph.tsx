import type { OpencodeXGoal, OpencodeXGoalNode, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal } from "solid-js"
import { formatRelative } from "../lib/format"
import {
  goalHeadline,
  goalNodeRows,
  goalProgress,
  isGoalSettled,
  type GoalNodeRow,
} from "../lib/goal-graph-view"
import type { SessionData } from "../lib/session-api"
import { Icon } from "./icon"
import { TranscriptPanel } from "./session-transcript-panel"
import type { SessionPageProps } from "./session-page-types"
import { Button } from "./ui"

const EMPTY_NODE_DATA: SessionData = { messages: [], todos: [], diffs: [] }

/**
 * The goal's graph on the session page. The user talks to one session; this is
 * where they watch the rest of the work happen and open any of it.
 */
export function SessionGoalGraph(props: { page: SessionPageProps }) {
  const selectedNode = createMemo(() => {
    const goal = props.page.goal
    const sessionID = props.page.teamMemberSessionID
    if (!goal || !sessionID) return undefined
    return goal.nodes.find((node) => node.sessionID === sessionID)
  })

  return (
    <>
      <Show when={props.page.goal}>
        {(goal) => (
          <GoalGraphPanel
            goal={goal()}
            selectedNodeID={selectedNode()?.id}
            open={(node) => node.sessionID && props.page.selectTeamMember?.(node.sessionID)}
            approve={(node, approved) => props.page.approveGoalNode?.(goal().id, node.id, approved)}
            cancel={() => props.page.cancelGoal?.(goal().id)}
          />
        )}
      </Show>
      <Show when={selectedNode()}>
        {(node) => (
          <GoalNodePane
            node={node()}
            data={props.page.teamMemberData}
            loading={props.page.teamMemberLoading === true}
            providers={props.page.providers}
            showTimestamps={props.page.showTimestamps}
            showThinking={props.page.showThinking}
            showToolDetails={props.page.showToolDetails}
            showScrollbar={props.page.showScrollbar}
            showGenericToolOutput={props.page.showGenericToolOutput}
            concealCodeBlocks={props.page.concealCodeBlocks === true}
            close={() => props.page.selectTeamMember?.("")}
          />
        )}
      </Show>
    </>
  )
}

function GoalGraphPanel(props: {
  goal: OpencodeXGoal
  selectedNodeID?: string
  open: (node: OpencodeXGoalNode) => void
  approve: (node: OpencodeXGoalNode, approved: boolean) => void
  cancel: () => void
}) {
  const [collapsed, setCollapsed] = createSignal(false)
  const rows = createMemo(() => goalNodeRows(props.goal))
  const progress = createMemo(() => goalProgress(props.goal))

  return (
    <section class="goal-graph" data-status={props.goal.status} aria-label={`Goal: ${props.goal.title}`}>
      <header class="goal-graph-header">
        <Button
          appearance="ghost"
          class="goal-graph-toggle"
          aria-expanded={!collapsed()}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Icon name={collapsed() ? "chevronRight" : "chevronDown"} />
          <span class="goal-graph-heading">
            <strong>{props.goal.title}</strong>
            <small>{goalHeadline(props.goal)}</small>
          </span>
        </Button>
        <span class="goal-graph-count">
          {progress().settled}/{progress().total}
        </span>
        <Show when={!isGoalSettled(props.goal)}>
          <Button appearance="ghost" size="compact" icon="x" onClick={() => props.cancel()}>
            Stop
          </Button>
        </Show>
      </header>
      <Show when={progress().total > 0}>
        <div class="goal-graph-progress" role="presentation">
          <span style={{ width: `${progress().percent}%` }} />
        </div>
      </Show>
      <Show when={!collapsed()}>
        <ol class="goal-graph-nodes">
          <For each={rows()}>
            {(row) => (
              <GoalNodeRow
                row={row}
                selected={row.node.id === props.selectedNodeID}
                open={() => props.open(row.node)}
                approve={(approved) => props.approve(row.node, approved)}
              />
            )}
          </For>
        </ol>
      </Show>
    </section>
  )
}

function GoalNodeRow(props: {
  row: GoalNodeRow
  selected: boolean
  open: () => void
  approve: (approved: boolean) => void
}) {
  const node = () => props.row.node
  return (
    <li class="goal-node" data-tone={props.row.tone} data-depth={props.row.depth} classList={{ selected: props.selected }}>
      <Button
        appearance="ghost"
        class="goal-node-open"
        disabled={!props.row.sessionID}
        title={props.row.sessionID ? "Open what this step did" : "This step has not run yet"}
        onClick={() => props.open()}
      >
        <span class="goal-node-dot" aria-hidden="true" />
        <span class="goal-node-copy">
          <strong>{node().title}</strong>
          <small>{props.row.detail || node().brief}</small>
        </span>
        <span class="goal-node-status">{node().status.replace("_", " ")}</span>
      </Button>
      <Show when={node().status === "awaiting_approval"}>
        <div class="goal-node-gate">
          <Button appearance="outline" size="compact" icon="check" onClick={() => props.approve(true)}>
            Approve
          </Button>
          <Button appearance="ghost" tone="danger" size="compact" icon="x" onClick={() => props.approve(false)}>
            Skip
          </Button>
        </div>
      </Show>
    </li>
  )
}

/**
 * One node's work. The prompt it received is shown verbatim above its
 * transcript, because that is the thing a reader needs to judge the output.
 */
function GoalNodePane(props: {
  node: OpencodeXGoalNode
  data?: SessionData
  loading: boolean
  providers: Provider[]
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  concealCodeBlocks: boolean
  close: () => void
}) {
  const [showPrompt, setShowPrompt] = createSignal(false)
  return (
    <section class="goal-node-pane">
      <header class="goal-node-pane-header">
        <div class="goal-node-pane-heading">
          <strong>{props.node.title}</strong>
          <span>
            {props.node.status === "running" || props.node.status === "dispatched"
              ? "Working..."
              : props.node.completedAt
                ? `Finished ${formatRelative(props.node.completedAt)}`
                : props.node.brief}
          </span>
        </div>
        <Show when={props.node.deliveredPrompt}>
          <Button
            appearance="ghost"
            size="compact"
            icon={showPrompt() ? "chevronDown" : "chevronRight"}
            onClick={() => setShowPrompt((value) => !value)}
          >
            Prompt it received
          </Button>
        </Show>
        <Button appearance="outline" size="compact" icon="x" onClick={() => props.close()}>
          Back
        </Button>
      </header>
      <Show when={showPrompt() && props.node.deliveredPrompt}>
        {(prompt) => <pre class="goal-node-prompt">{prompt()}</pre>}
      </Show>
      <TranscriptPanel
        sessionID={props.node.sessionID ?? ""}
        data={props.data ?? EMPTY_NODE_DATA}
        loading={props.loading}
        providers={props.providers}
        showTimestamps={props.showTimestamps}
        showThinking={props.showThinking}
        showToolDetails={props.showToolDetails}
        showScrollbar={props.showScrollbar}
        showGenericToolOutput={props.showGenericToolOutput}
        concealCodeBlocks={props.concealCodeBlocks}
        running={["running", "dispatched"].includes(props.node.status)}
        emptyStateDismissed
      />
      <footer class="goal-node-note">
        <span>Read-only view - steer this goal by messaging the orchestrator.</span>
      </footer>
    </section>
  )
}
