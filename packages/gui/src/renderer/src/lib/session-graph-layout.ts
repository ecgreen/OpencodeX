import type { SessionGraph, SessionGraphEdge, SessionGraphNode } from "./session-graph"

/**
 * Layered left-to-right placement for the workflow graph.
 *
 * Deliberately not a force simulation: the same graph must land in the same
 * pixels on every render, or live status updates would make the canvas twitch.
 * Ordering inside a layer follows the parents' vertical order (a barycentre
 * pass), which is enough to keep edges short without full crossing removal.
 */

export const GRAPH_NODE_WIDTH = 212
export const GRAPH_NODE_HEIGHT = 76
export const GRAPH_COLUMN_GAP = 76
export const GRAPH_ROW_GAP = 20
export const GRAPH_PADDING = 40

const ROW_PITCH = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP
const COLUMN_PITCH = GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP

export type SessionGraphLayoutNode = {
  node: SessionGraphNode
  x: number
  y: number
  width: number
  height: number
}

export type SessionGraphLayoutEdge = {
  edge: SessionGraphEdge
  path: string
  labelX: number
  labelY: number
}

export type SessionGraphBounds = { x: number; y: number; width: number; height: number }

export type SessionGraphLayout = {
  nodes: SessionGraphLayoutNode[]
  edges: SessionGraphLayoutEdge[]
  bounds: SessionGraphBounds
}

export const EMPTY_SESSION_GRAPH_LAYOUT: SessionGraphLayout = {
  nodes: [],
  edges: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
}

export function layoutSessionGraph(graph: SessionGraph): SessionGraphLayout {
  if (graph.nodes.length === 0) return EMPTY_SESSION_GRAPH_LAYOUT
  const parents = groupParents(graph.edges)
  const centers = new Map<string, number>()
  for (const depth of layerDepths(graph.nodes)) {
    const layer = graph.nodes.filter((node) => node.depth === depth)
    const ordered = orderLayer(layer, parents, centers)
    const shift = layerShift(ordered, parents, centers)
    ordered.forEach((node, slot) => centers.set(node.id, slot * ROW_PITCH + shift))
  }
  const nodes = graph.nodes.map((node) => ({
    node,
    x: node.depth * COLUMN_PITCH,
    y: Math.round(centers.get(node.id) ?? 0),
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
  }))
  const byID = new Map(nodes.map((item) => [item.node.id, item]))
  const edges = graph.edges.flatMap((edge) => {
    const from = byID.get(edge.from)
    const to = byID.get(edge.to)
    return from && to ? [edgePath(edge, from, to)] : []
  })
  return { nodes, edges, bounds: layoutBounds(nodes) }
}

export function sessionGraphLayoutNode(layout: SessionGraphLayout, id: string) {
  return layout.nodes.find((item) => item.node.id === id)
}

/** The box a "fit to view" should frame, padded so nodes never touch the edge. */
export function paddedBounds(bounds: SessionGraphBounds): SessionGraphBounds {
  return {
    x: bounds.x - GRAPH_PADDING,
    y: bounds.y - GRAPH_PADDING,
    width: bounds.width + GRAPH_PADDING * 2,
    height: bounds.height + GRAPH_PADDING * 2,
  }
}

function layerDepths(nodes: readonly SessionGraphNode[]) {
  return [...new Set(nodes.map((node) => node.depth))].sort((left, right) => left - right)
}

/**
 * Sorts a layer by the average position of each node's parents. Nodes whose
 * parents are not placed yet keep their incoming order, and the original index
 * breaks ties so the result never depends on sort implementation details.
 */
function orderLayer(
  layer: readonly SessionGraphNode[],
  parents: ReadonlyMap<string, string[]>,
  centers: ReadonlyMap<string, number>,
) {
  return layer
    .map((node, index) => ({ node, index, key: barycenter(node, parents, centers) ?? index * ROW_PITCH }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((entry) => entry.node)
}

/**
 * Slides a whole column so it sits opposite its parents. Columns never share an
 * x range, so moving one vertically can not collide with another.
 */
function layerShift(
  ordered: readonly SessionGraphNode[],
  parents: ReadonlyMap<string, string[]>,
  centers: ReadonlyMap<string, number>,
) {
  const anchored = ordered.flatMap((node, slot) => {
    const center = barycenter(node, parents, centers)
    return center === undefined ? [] : [center - slot * ROW_PITCH]
  })
  if (anchored.length === 0) return 0
  return anchored.reduce((total, value) => total + value, 0) / anchored.length
}

function barycenter(
  node: SessionGraphNode,
  parents: ReadonlyMap<string, string[]>,
  centers: ReadonlyMap<string, number>,
) {
  const placed = (parents.get(node.id) ?? []).flatMap((id) => {
    const center = centers.get(id)
    return center === undefined ? [] : [center]
  })
  if (placed.length === 0) return undefined
  return placed.reduce((total, value) => total + value, 0) / placed.length
}

function groupParents(edges: readonly SessionGraphEdge[]) {
  const parents = new Map<string, string[]>()
  for (const edge of edges) parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from])
  return parents
}

/**
 * A cubic bezier leaving the parent's right edge and arriving at the child's
 * left edge. Both control points sit on their own node's horizontal, so the
 * curve leaves and lands flat and reads as a connector rather than a wire.
 */
function edgePath(
  edge: SessionGraphEdge,
  from: SessionGraphLayoutNode,
  to: SessionGraphLayoutNode,
): SessionGraphLayoutEdge {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const control = Math.max(GRAPH_COLUMN_GAP / 2, (endX - startX) / 2)
  return {
    edge,
    path: `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`,
    // A cubic whose control points share their endpoint's y passes through the
    // midpoint of the two endpoints at t = 0.5.
    labelX: Math.round((startX + endX) / 2),
    labelY: Math.round((startY + endY) / 2),
  }
}

function layoutBounds(nodes: readonly SessionGraphLayoutNode[]): SessionGraphBounds {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...nodes.map((item) => item.x))
  const top = Math.min(...nodes.map((item) => item.y))
  const right = Math.max(...nodes.map((item) => item.x + item.width))
  const bottom = Math.max(...nodes.map((item) => item.y + item.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
