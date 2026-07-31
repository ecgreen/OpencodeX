import { Show } from "solid-js"
import { formatRelative } from "../lib/format"
import type { SessionGraphEdge, SessionGraphNode } from "../lib/session-graph"
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
  edge?: SessionGraphEdge
  selected: boolean
  open: (node: SessionGraphNode) => void
  openFullPage: (node: SessionGraphNode) => void
  hover: (id: string) => void
}) {
  const node = () => props.placed.node
  const progress = () => node().progress
  const ratio = () => {
    const value = progress()
    if (!value || value.total <= 0) return undefined
    return (value.completed + value.failed) / value.total
  }
  return (
    <div
      class="session-graph-node-anchor"
      style={{
        left: `${props.placed.x}px`,
        top: `${props.placed.y}px`,
        width: `${props.placed.width}px`,
        height: `${props.placed.height}px`,
      }}
    >
      <Tooltip class="session-graph-node-trigger" placement="top" label={<NodeTooltip node={node()} edge={props.edge} />}>
        <Button
          appearance="ghost"
          class="session-graph-node"
          classList={{ selected: props.selected, root: node().root }}
          data-graph-status={node().status}
          data-graph-kind={node().kind}
          aria-label={`${node().title}. ${node().statusLabel}.${node().role ? ` ${node().role}.` : ""}`}
          aria-current={props.selected ? "true" : undefined}
          disabled={!node().sessionID}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => props.hover(node().id)}
          onPointerLeave={() => props.hover("")}
          onFocus={() => props.hover(node().id)}
          onBlur={() => props.hover("")}
          onClick={(event) => (event.metaKey || event.ctrlKey ? props.openFullPage(node()) : props.open(node()))}
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
                <Icon name={badge() === "success" ? "check" : "x"} />
              </span>
            )}
          </Show>
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * Hover and focus detail. The incoming edge is repeated here because edge
 * labels are pointer-only: this is how a keyboard reader learns what the step
 * was asked to resolve.
 */
function NodeTooltip(props: { node: SessionGraphNode; edge?: SessionGraphEdge }) {
  return (
    <span class="session-graph-tooltip">
      <span class="session-graph-tooltip-title">{props.node.title}</span>
      <span class="session-graph-tooltip-status">
        {props.node.statusLabel}
        <Show when={props.node.progress && props.node.progress.total > 0}>
          {` - ${props.node.progress!.completed} of ${props.node.progress!.total} done`}
        </Show>
        <Show when={(props.node.progress?.failed ?? 0) > 0}>{`, ${props.node.progress!.failed} failed`}</Show>
      </span>
      <Show when={props.edge?.detail}>
        {(detail) => <span class="session-graph-tooltip-detail">Resolving: {detail()}</span>}
      </Show>
      <Show when={props.node.detail}>
        {(detail) => <span class="session-graph-tooltip-detail">{detail()}</span>}
      </Show>
      <Show when={props.node.sessionID} fallback={<span class="session-graph-tooltip-hint">Not started yet</span>}>
        <span class="session-graph-tooltip-hint">Click to read this session</span>
      </Show>
    </span>
  )
}
