import { For, Show, createEffect, createMemo } from "solid-js"
import { sessionGraphSummary, type SessionGraph, type SessionGraphNode } from "../lib/session-graph"
import { paddedBounds } from "../lib/session-graph-layout"
import { graphTransform } from "../lib/session-graph-viewport"
import { createSessionGraphViewController } from "./session-side-graph-controller"
import { SessionGraphNodeCard } from "./session-graph-node"
import { EmptyState, IconButton, Tooltip } from "./ui"

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
}) {
  const controller = createSessionGraphViewController({ graph: () => props.graph })
  const frame = createMemo(() => paddedBounds(controller.layout().bounds))

  // Selecting a node elsewhere (or restoring a selection) should not leave the
  // reader looking at an empty part of the canvas.
  createEffect(() => {
    if (props.selectedNodeID) controller.reveal(props.selectedNodeID)
  })

  return (
    <section class="session-graph">
      <Show
        when={props.graph.nodes.length > 0}
        fallback={
          <EmptyState
            class="session-graph-empty"
            title="No workflow graph yet"
            description="Delegate to subagents, run a swarm, or give this session a longer-running goal, and the steps will appear here as a graph."
          />
        }
      >
        <div
          class="session-graph-canvas"
          classList={{ panning: controller.panning() }}
          ref={controller.setCanvas}
          role="group"
          aria-label={sessionGraphSummary(props.graph)}
          tabindex={0}
          onPointerDown={controller.startPan}
          onKeyDown={controller.handleKeyDown}
        >
          <div class="session-graph-scene" style={{ transform: graphTransform(controller.viewport()) }}>
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
                    classList={{ hovered: controller.hoveredEdgeID() === edge.edge.id }}
                    data-graph-status={edge.edge.status}
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
                        <span class="session-graph-tooltip-title">{edge.edge.label}</span>
                        <Show when={edge.edge.detail}>
                          {(detail) => <span class="session-graph-tooltip-detail">{detail()}</span>}
                        </Show>
                      </span>
                    }
                  >
                    <span class="session-graph-edge-label ds-truncate" data-graph-status={edge.edge.status}>
                      {edge.edge.label}
                    </span>
                  </Tooltip>
                </div>
              )}
            </For>
            <For each={controller.layout().nodes}>
              {(placed) => (
                <SessionGraphNodeCard
                  placed={placed}
                  edge={controller.incomingEdge(placed.node.id)}
                  selected={props.selectedNodeID === placed.node.id}
                  open={props.open}
                  openFullPage={props.openFullPage}
                  hover={(id) => controller.setHoveredNodeID(id)}
                />
              )}
            </For>
          </div>
        </div>
        <footer class="session-graph-bar">
          <p class="session-graph-counts">
            <span>{sessionGraphSummary(props.graph).replace("Workflow graph: ", "")}</span>
          </p>
          <div class="session-graph-zoom">
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
        </footer>
      </Show>
    </section>
  )
}
