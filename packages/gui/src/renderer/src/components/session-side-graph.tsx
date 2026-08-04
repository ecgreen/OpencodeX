import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import {
  sessionGraphAvailable,
  sessionGraphSummary,
  type SessionGraph,
  type SessionGraphNode,
} from "../lib/session-graph"
import type { SessionGraphGate } from "../lib/session-graph-goal"
import { graphTopologyIncomplete, type GraphTopologyState } from "../lib/session-graph-fetch"
import { paddedBounds } from "../lib/session-graph-layout"
import { graphTransform } from "../lib/session-graph-viewport"
import { createSessionGraphViewController } from "./session-side-graph-controller"
import { SessionGraphNodeCard } from "./session-graph-node"
import { Button, EmptyState, IconButton, LoadingState, Tooltip } from "./ui"

/** What each line style claims, said in words wherever an edge is inspected. */
const PROVENANCE_LABEL: Record<string, string> = {
  observed_spawn: "Observed delegation",
  declared_dependency: "Declared dependency",
  inferred_sequence: "Inferred ordering",
  synthetic_return: "Results fan-in",
  planned: "Planned step",
}

/**
 * The workspace Graph tab: the session's agentic workflow as a pannable,
 * zoomable diagram.
 *
 * Edges are one SVG layer and nodes are positioned HTML on top of it, both
 * inside a single CSS-transformed scene. Text therefore gets real ellipsis and
 * theme tokens instead of hand-measured SVG glyphs, and pan/zoom stays one
 * transform rather than a per-element recalculation.
 */
export function SessionSideGraph(props: {
  graph: SessionGraph
  selectedNodeID: string
  open: (node: SessionGraphNode) => void
  openFullPage: (node: SessionGraphNode) => void
  canOpenFullPage?: (sessionID: string) => boolean
  approve?: (gate: SessionGraphGate, approved: boolean) => void
  /** Completeness of the drawn graph: loading, stale, error, truncated. */
  topology?: GraphTopologyState
  retryTopology?: () => void
}) {
  const controller = createSessionGraphViewController({
    graph: () => props.graph,
    selectedNodeID: () => props.selectedNodeID,
  })
  const frame = createMemo(() => paddedBounds(controller.layout().bounds))
  const [legendOpen, setLegendOpen] = createSignal(false)
  let legendRoot: HTMLElement | undefined
  let legendToggle: HTMLElement | undefined

  // The legend behaves like every popover in the app: Escape closes it and
  // returns focus to its toggle, and a press anywhere outside dismisses it.
  createEffect(() => {
    if (!legendOpen()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      setLegendOpen(false)
      legendToggle?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && legendRoot?.contains(event.target)) return
      setLegendOpen(false)
    }
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
    })
  })
  const incomplete = () => props.topology !== undefined && graphTopologyIncomplete(props.topology)
  const summary = () => sessionGraphSummary(props.graph, { incomplete: incomplete() })
  const noticeText = () => {
    if (props.topology?.phase === "partial") return "Some branches could not be loaded."
    if (props.topology?.phase === "stale") return "Showing the last loaded workflow - a refresh failed."
    if (props.topology?.phase === "error") return "Some of this workflow could not be loaded."
    return ""
  }

  // Selecting a node elsewhere (or restoring a selection) should not leave the
  // reader looking at an empty part of the canvas. `on` keeps reveal's own
  // viewport reads out of the tracking scope: reveal writes the viewport, and
  // an effect that both tracked and wrote it would re-run on its own write -
  // forever, if the node can never fit the pane at the current zoom.
  createEffect(
    on(
      () => props.selectedNodeID,
      (selected) => {
        if (selected) controller.reveal(selected)
      },
    ),
  )

  // The drawer opening or resizing shrinks the canvas; the node the reader is
  // inspecting must not slide out from beside its own transcript. Deferred so
  // the initial measurement stays the auto-fit's job.
  createEffect(
    on(
      () => `${controller.size().width}x${controller.size().height}`,
      () => {
        if (props.selectedNodeID) controller.reveal(props.selectedNodeID)
      },
      { defer: true },
    ),
  )

  // Hover is relational: pointing at a node lights the edges that feed and
  // leave it, and pointing at an edge lights both of its endpoint cards, so
  // the reader traces flow without following curves by eye.
  const hoveredEdge = createMemo(() =>
    props.graph.edges.find((edge) => edge.id === controller.hoveredEdgeID()),
  )
  const edgeTouchesHoveredNode = (edge: { from: string; to: string }) => {
    const hovered = controller.hoveredNodeID()
    return Boolean(hovered) && (edge.from === hovered || edge.to === hovered)
  }

  // What a screen reader hears when the selection or the graph's completeness
  // changes; the visual selection ring and canvas notices say the same things.
  const announcement = createMemo(() => {
    const selected = props.graph.nodes.find((node) => node.id === props.selectedNodeID)
    const parts: string[] = []
    if (selected) {
      parts.push(`Selected ${selected.title}, ${selected.statusLabel}.`)
      if (selected.detail) parts.push(selected.detail)
    }
    if (props.topology?.phase === "error") parts.push("The workflow graph could not be loaded.")
    else if (props.topology?.phase === "stale") parts.push("Showing the last loaded workflow.")
    else if (props.topology?.phase === "partial") parts.push("Some branches could not be loaded.")
    if (props.topology && props.topology.unexpanded.length > 0) parts.push("The graph may be incomplete.")
    return parts.join(" ")
  })

  return (
    <section class="session-graph">
      <Show
        when={sessionGraphAvailable(props.graph)}
        fallback={
          <Show
            when={props.topology?.phase === "error"}
            fallback={
              <Show
                when={props.topology?.phase === "loading"}
                fallback={
                  <EmptyState
                    class="session-graph-empty"
                    title="No workflow graph yet"
                    description="Delegate to subagents, run a swarm, or give this session a longer-running goal, and the steps will appear here as a graph."
                  />
                }
              >
                {/* The first sweep is running: not an empty workflow, just an
                    unanswered question. */}
                <LoadingState class="session-graph-empty" title="Discovering delegated sessions" />
              </Show>
            }
          >
            <EmptyState
              class="session-graph-empty"
              title="Couldn't load the workflow graph"
              description={props.topology?.error || "The delegation tree could not be fetched."}
              action={
                props.retryTopology ? (
                  <Button
                    appearance="outline"
                    size="compact"
                    icon="refresh"
                    disabled={props.topology?.refreshing === true}
                    onClick={() => props.retryTopology?.()}
                  >
                    {props.topology?.refreshing ? "Retrying..." : "Retry"}
                  </Button>
                ) : undefined
              }
            />
          </Show>
        }
      >
        <div
          class="session-graph-canvas"
          classList={{ panning: controller.panning() }}
          ref={controller.setCanvas}
          role="group"
          aria-label={summary()}
          aria-describedby="session-graph-keys"
          tabindex={0}
          onPointerDown={controller.startPan}
          onKeyDown={controller.handleKeyDown}
        >
          <span id="session-graph-keys" class="ds-visually-hidden">
            Arrow keys pan the canvas. From a step, arrow keys move between steps. Plus and minus zoom, zero
            fits the graph.
          </span>
          <span class="ds-visually-hidden" aria-live="polite">
            {announcement()}
          </span>
          <Show when={noticeText()}>
            <div class="session-graph-notice" role="status">
              <span>{noticeText()}</span>
              <Show when={props.retryTopology}>
                <Button
                  appearance="outline"
                  size="compact"
                  icon="refresh"
                  disabled={props.topology?.refreshing === true}
                  onClick={() => props.retryTopology?.()}
                >
                  {props.topology?.refreshing ? "Retrying..." : "Retry"}
                </Button>
              </Show>
            </div>
          </Show>
          {/* What lies past each edge, weighted toward attention: the graph
              may be framed readably instead of fully, and hidden work must
              stay discoverable. Activating a chip pans a screenful that way. */}
          <For each={["left", "right", "up", "down"] as const}>
            {(edge) => (
              <Show when={controller.offscreen()[edge].count > 0}>
                <Button
                  appearance="outline"
                  size="compact"
                  class="session-graph-offscreen"
                  data-edge={edge}
                  classList={{ attention: controller.offscreen()[edge].attention > 0 }}
                  aria-label={`${controller.offscreen()[edge].count} more ${
                    controller.offscreen()[edge].attention > 0 ? "steps, some needing attention," : "steps"
                  } beyond the ${edge === "up" ? "top" : edge === "down" ? "bottom" : edge} edge - pan there`}
                  onClick={() => controller.panToward(edge)}
                >
                  {controller.offscreen()[edge].attention > 0 ? "! " : ""}
                  {controller.offscreen()[edge].count}
                  {edge === "left" ? " ←" : edge === "right" ? " →" : edge === "up" ? " ↑" : " ↓"}
                </Button>
              </Show>
            )}
          </For>
          <div
            class="session-graph-scene"
            style={{
              transform: graphTransform(controller.viewport()),
              // Read back by the edge hit targets to counter the zoom: a hit
              // area must hold its screen size whatever the scene scale is.
              "--graph-scale": String(controller.viewport().scale),
            }}
          >
            <svg
              class="session-graph-edges"
              aria-hidden="true"
              viewBox={`${frame().x} ${frame().y} ${frame().width} ${frame().height}`}
              style={{
                left: `${frame().x}px`,
                top: `${frame().y}px`,
                width: `${frame().width}px`,
                height: `${frame().height}px`,
              }}
            >
              <For each={controller.layout().edges}>
                {(edge) => (
                  <path
                    class="session-graph-edge-path"
                    classList={{
                      hovered: controller.hoveredEdgeID() === edge.edge.id,
                      connected: edgeTouchesHoveredNode(edge.edge),
                    }}
                    data-graph-status={edge.edge.status}
                    data-graph-provenance={edge.edge.provenance}
                    d={edge.path}
                  />
                )}
              </For>
            </svg>
            <For each={controller.layout().edges}>
              {(edge) => (
                <div
                  class="session-graph-edge-anchor"
                  style={{ left: `${edge.labelX}px`, top: `${edge.labelY}px` }}
                  onPointerEnter={() => controller.setHoveredEdgeID(edge.edge.id)}
                  onPointerLeave={() => controller.setHoveredEdgeID("")}
                >
                  <Tooltip
                    placement="top"
                    label={
                      <span class="session-graph-tooltip">
                        <span class="session-graph-tooltip-provenance">
                          {PROVENANCE_LABEL[edge.edge.provenance]}
                        </span>
                        <span class="session-graph-tooltip-title">{edge.edge.label}</span>
                        <Show when={edge.edge.detail}>
                          {(detail) => <span class="session-graph-tooltip-detail">{detail()}</span>}
                        </Show>
                      </span>
                    }
                  >
                    {/* Pointer-only marker: the same intent text is in the
                        target node's focusable tooltip for keyboard readers.
                        The wrapper, not the 9px diamond, is the hit target. */}
                    <span class="session-graph-edge-hit" aria-hidden="true">
                      <span
                        class="session-graph-edge-marker"
                        data-graph-status={edge.edge.status}
                        data-graph-provenance={edge.edge.provenance}
                      />
                    </span>
                  </Tooltip>
                </div>
              )}
            </For>
            <For each={controller.layout().nodes}>
              {(placed) => (
                <SessionGraphNodeCard
                  placed={placed}
                  edges={controller.incomingEdges(placed.node.id)}
                  selected={props.selectedNodeID === placed.node.id}
                  edgeEndpoint={
                    hoveredEdge()?.from === placed.node.id || hoveredEdge()?.to === placed.node.id
                  }
                  open={props.open}
                  openFullPage={props.openFullPage}
                  canOpenFullPage={props.canOpenFullPage}
                  hover={(id) => controller.setHoveredNodeID(id)}
                  neighbor={controller.neighborNodeID}
                  approve={props.approve}
                />
              )}
            </For>
          </div>
        </div>
        <footer class="session-graph-bar" ref={legendRoot}>
          <p class="session-graph-counts ds-tabular">
            <span>{summary().replace("Workflow graph: ", "")}</span>
          </p>
          <div class="session-graph-zoom">
            <IconButton
              ref={(element: HTMLElement) => {
                legendToggle = element
              }}
              appearance="ghost"
              size="compact"
              icon="help"
              label="Graph legend"
              aria-expanded={legendOpen()}
              aria-controls="session-graph-legend"
              onClick={() => setLegendOpen((open) => !open)}
            />
            <IconButton
              appearance="ghost"
              size="compact"
              icon="minus"
              label="Zoom out"
              onClick={controller.zoomOut}
            />
            <span class="session-graph-zoom-value">{controller.zoomPercent()}%</span>
            <IconButton appearance="ghost" size="compact" icon="plus" label="Zoom in" onClick={controller.zoomIn} />
            <IconButton
              appearance="ghost"
              size="compact"
              icon="fit"
              label="Fit graph to view"
              onClick={controller.fit}
            />
          </div>
          <Show when={legendOpen()}>
            <div id="session-graph-legend" class="session-graph-legend" role="note" aria-label="Graph legend">
              <p><strong>Cards</strong> are workflow steps; a dashed <strong>Merge results</strong> card is where branches report back, not a session of its own.</p>
              <p><strong>Solid edges</strong> are observed delegations. <strong>Dashed edges</strong> are inferred ordering - one step started after another returned. <strong>Dotted edges</strong> are planned steps that have not run.</p>
              <p>A step with no badge has no verified outcome; <strong>Returned</strong> means it came back without recording how it went.</p>
            </div>
          </Show>
        </footer>
      </Show>
    </section>
  )
}
