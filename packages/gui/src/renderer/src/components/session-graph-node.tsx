import { For, Show, createSignal } from "solid-js"
import { formatRelative } from "../lib/format"
import type { SessionGraphEdge, SessionGraphNode } from "../lib/session-graph"
import type { SessionGraphGate } from "../lib/session-graph-goal"
import type { SessionGraphLayoutNode } from "../lib/session-graph-layout"
import { Icon } from "./icon"
import { Button, ProgressMeter, Tooltip } from "./ui"

/**
 * One step of the workflow.
 *
 * The card is absolutely positioned in graph coordinates inside the canvas's
 * transformed layer, so pan and zoom move it without this component knowing
 * about either. Status is carried by tone *and* by the corner badge and status
 * text, so it survives a reader who cannot separate the two colors.
 */
export function SessionGraphNodeCard(props: {
  placed: SessionGraphLayoutNode
  edges: readonly SessionGraphEdge[]
  selected: boolean
  /** True while a hovered edge starts or ends at this node. */
  edgeEndpoint?: boolean
  open: (node: SessionGraphNode) => void
  openFullPage: (node: SessionGraphNode) => void
  /** Whether the full-page route can resolve this node's session. */
  canOpenFullPage?: (sessionID: string) => boolean
  hover: (id: string) => void
  /** Roving focus: the node to move to for an arrow key, if any. */
  neighbor?: (fromID: string, key: string) => string
  /** Answers a parked gate. The canvas is the only place a goal can be unblocked. */
  approve?: (gate: SessionGraphGate, approved: boolean) => void
}) {
  const node = () => props.placed.node
  const progress = () => node().progress
  const ratio = () => {
    const value = progress()
    if (!value || value.total <= 0) return undefined
    return (value.completed + value.failed) / value.total
  }
  const activate = (event: MouseEvent) => {
    if (!(event.metaKey || event.ctrlKey)) {
      props.open(node())
      return
    }
    // Ctrl/Cmd-click promises a full page; when the route cannot resolve this
    // session (a catalog-hidden child), stay embedded instead of navigating to
    // a page that would come up empty.
    const sessionID = node().sessionID
    if (sessionID && props.canOpenFullPage && !props.canOpenFullPage(sessionID)) {
      props.open(node())
      return
    }
    props.openFullPage(node())
  }
  const roam = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    if (!props.neighbor) return
    const targetID = props.neighbor(node().id, event.key)
    if (!targetID) return
    event.preventDefault()
    // Stop the canvas from also panning on the same press.
    event.stopPropagation()
    const canvas = event.currentTarget.closest(".session-graph-canvas")
    canvas?.querySelector<HTMLElement>(`[data-graph-node-id="${CSS.escape(targetID)}"]`)?.focus()
  }
  return (
    <div
      class="session-graph-node-anchor"
      classList={{ gated: Boolean(props.approve && node().gate) }}
      style={{
        left: `${props.placed.x}px`,
        top: `${props.placed.y}px`,
        width: `${props.placed.width}px`,
        height: `${props.placed.height}px`,
      }}
    >
      <Tooltip class="session-graph-node-trigger" placement="top" label={<NodeTooltip node={node()} edges={props.edges} />}>
        <Button
          appearance="ghost"
          class="session-graph-node"
          classList={{ selected: props.selected, root: node().root, "edge-endpoint": props.edgeEndpoint }}
          data-graph-status={node().status}
          data-graph-kind={node().kind}
          data-graph-badge={node().badge}
          data-graph-node-id={node().id}
          aria-label={`${node().title}. ${node().statusLabel}.${node().role ? ` ${node().role}.` : ""}`}
          aria-current={props.selected ? "true" : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => props.hover(node().id)}
          onPointerLeave={() => props.hover("")}
          onFocus={() => props.hover(node().id)}
          onBlur={() => props.hover("")}
          onKeyDown={roam}
          onClick={activate}
        >
          <span class="session-graph-node-head">
            <span class="session-graph-node-title ds-truncate">
              <Show when={node().kind === "join"}>
                <Icon name="merge" />
              </Show>
              {node().title}
            </span>
            <Show when={node().role}>
              {(role) => <span class="session-graph-node-role ds-truncate">{role()}</span>}
            </Show>
          </span>
          <span class="session-graph-node-foot">
            <span class="session-graph-node-status">{node().statusLabel}</span>
            <Show when={node().updatedAt > 0}>
              <span class="session-graph-node-time">{formatRelative(node().updatedAt)}</span>
            </Show>
          </span>
          <Show when={ratio() !== undefined}>
            <ProgressMeter
              class="session-graph-node-meter"
              value={ratio()}
              tone={progress()!.failed > 0 ? "danger" : "accent"}
            />
          </Show>
          <Show when={node().badge}>
            {(badge) => (
              <span class="session-graph-node-badge" data-graph-badge={badge()}>
                <Icon
                  name={
                    badge() === "success"
                      ? "check"
                      : badge() === "warning"
                        ? "warning"
                        : badge() === "cancelled"
                          ? "stop"
                          : "x"
                  }
                />
              </span>
            )}
          </Show>
        </Button>
      </Tooltip>
      {/* In flow below the card, not overhanging it: layout reserves this row
          (see graphNodeHeight), so gates never overlap the next node or fall
          outside fit-to-view. A sibling of the card, not a child - the card is
          itself a button and cannot contain these two. */}
      <Show when={props.approve && node().gate}>
        {(gate) => <GateActions title={node().title} gate={gate()} approve={props.approve!} />}
      </Show>
    </div>
  )
}

/**
 * A parked gate's two answers. Approving is a plain click; skipping bypasses
 * declared work and arms first - the same press-again pattern the abort
 * control uses - so a stray click cannot silently drop a step. Focus leaving
 * the button disarms it.
 */
function GateActions(props: {
  title: string
  gate: SessionGraphGate
  approve: (gate: SessionGraphGate, approved: boolean) => void
}) {
  const [skipArmed, setSkipArmed] = createSignal(false)
  return (
    <div class="session-graph-node-gate">
      <Button appearance="outline" size="compact" icon="check" onClick={() => props.approve(props.gate, true)}>
        Approve
      </Button>
      <Tooltip placement="bottom" label={<span class="session-graph-tooltip">This step will not run.</span>}>
        <Button
          appearance={skipArmed() ? "solid" : "ghost"}
          tone="danger"
          size="compact"
          icon="x"
          aria-label={
            skipArmed()
              ? `Confirm skipping ${props.title} - this step will not run`
              : `Skip ${props.title} - this step will not run`
          }
          onBlur={() => setSkipArmed(false)}
          onPointerLeave={() => setSkipArmed(false)}
          onClick={() => {
            if (!skipArmed()) {
              setSkipArmed(true)
              return
            }
            setSkipArmed(false)
            props.approve(props.gate, false)
          }}
        >
          {skipArmed() ? "Really skip?" : "Skip step"}
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * Hover and focus detail. Incoming edges are repeated here because edge labels
 * are pointer-only: this is how a keyboard reader learns what the step was
 * asked to resolve, and - for a merge or a multi-input planned step - every
 * dependency feeding it. Status carries its tone here too, so the card and
 * its tooltip agree in color as well as words.
 */
function NodeTooltip(props: { node: SessionGraphNode; edges: readonly SessionGraphEdge[] }) {
  const described = () => props.edges.filter((edge) => edge.detail)
  return (
    <span class="session-graph-tooltip">
      <Show when={props.node.role}>
        {(role) => <span class="session-graph-tooltip-role">{role()}</span>}
      </Show>
      <span class="session-graph-tooltip-title">{props.node.title}</span>
      <span class="session-graph-tooltip-status" data-graph-status={props.node.status}>
        <span class="session-graph-tooltip-status-dot" aria-hidden="true" />
        {props.node.statusLabel}
        <Show when={props.node.progress && props.node.progress.total > 0}>
          {` - ${props.node.progress!.completed} of ${props.node.progress!.total} done`}
        </Show>
        <Show when={(props.node.progress?.failed ?? 0) > 0}>{`, ${props.node.progress!.failed} failed`}</Show>
      </span>
      <Show when={props.node.summary}>
        {(summary) => (
          <span class="session-graph-tooltip-section">
            <span class="session-graph-tooltip-caption">Summary</span>
            <span class="session-graph-tooltip-detail">{summary()}</span>
          </span>
        )}
      </Show>
      <Show when={props.node.detail}>
        {(detail) => <span class="session-graph-tooltip-detail">{detail()}</span>}
      </Show>
      <Show when={described().length === 1}>
        <span class="session-graph-tooltip-section">
          <span class="session-graph-tooltip-caption">Resolving</span>
          <span class="session-graph-tooltip-detail">{described()[0].detail}</span>
        </span>
      </Show>
      <Show when={described().length > 1}>
        <span class="session-graph-tooltip-section">
          <span class="session-graph-tooltip-caption">Fed by {described().length} steps</span>
          <For each={described()}>
            {(edge) => <span class="session-graph-tooltip-detail session-graph-tooltip-item">{edge.detail}</span>}
          </For>
        </span>
      </Show>
      <Show
        when={props.node.sessionID && props.node.kind !== "sentinel"}
        fallback={
          <span class="session-graph-tooltip-hint">
            {props.node.kind === "sentinel"
              ? "Discovery stopped here - retry loads more"
              : "Not started yet - activating selects it"}
          </span>
        }
      >
        <span class="session-graph-tooltip-hint">Click to read this session</span>
      </Show>
    </span>
  )
}
