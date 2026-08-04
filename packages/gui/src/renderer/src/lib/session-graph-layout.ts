import type { SessionGraph, SessionGraphEdge, SessionGraphNode } from "./session-graph"

/**
 * Layered left-to-right placement for the workflow graph.
 *
 * Deliberately not a force simulation: the same graph must land in the same
 * pixels on every render, or live status updates would make the canvas twitch.
 * Ordering inside a layer follows the parents' vertical order (a barycentre
 * pass), which is enough to keep edges short without full crossing removal.
 */

/**
 * Card geometry is sized for reading, not for fitting: the card carries a
 * two-line title, a role, and a status line at full body sizes, so shrinking
 * it only moves the squinting from the type scale to the zoom level.
 */
export const GRAPH_NODE_WIDTH = 264
export const GRAPH_NODE_HEIGHT = 104
/**
 * The action row a parked approval gate adds below its card: a compact control
 * plus its gap. Layout must know it, or two gated siblings overlap and a
 * bottom-row gate clips outside fit-to-view.
 */
export const GRAPH_GATE_ROW_HEIGHT = 40
export const GRAPH_COLUMN_GAP = 90
export const GRAPH_ROW_GAP = 28
export const GRAPH_PADDING = 40

const ROW_PITCH = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP
const COLUMN_PITCH = GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP

/** A node's real drawn height: gated nodes reserve their action row. */
export function graphNodeHeight(node: SessionGraphNode) {
  return GRAPH_NODE_HEIGHT + (node.gate ? GRAPH_GATE_ROW_HEIGHT : 0)
}

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
    // Rows accumulate real heights rather than assuming one pitch, so a gated
    // node's action row pushes the next row down instead of being overlapped.
    const offsets: number[] = []
    let stack = 0
    for (const node of ordered) {
      offsets.push(stack)
      stack += graphNodeHeight(node) + GRAPH_ROW_GAP
    }
    const shift = layerShift(ordered, offsets, parents, centers)
    ordered.forEach((node, slot) => centers.set(node.id, offsets[slot] + shift))
  }
  const nodes = graph.nodes
    .map((node) => ({
      node,
      x: node.depth * COLUMN_PITCH,
      y: Math.round(centers.get(node.id) ?? 0),
      width: GRAPH_NODE_WIDTH,
      height: graphNodeHeight(node),
    }))
    // Spatial reading order, so tab order walks columns left to right and each
    // column top to bottom instead of following depth-first emission order.
    .toSorted(
      (left, right) => left.node.depth - right.node.depth || left.y - right.y || left.node.id.localeCompare(right.node.id),
    )
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

/**
 * The nearest node in the pressed direction, for roving focus between cards.
 * Distance is centre to centre with the off-axis component weighted, so
 * "right" prefers the node actually to the right over a nearer diagonal.
 * Every placed node is a candidate - planned steps, merges, and discovery
 * markers are all selectable, so none of them may strand focus.
 */
export function spatialGraphNeighbor(
  nodes: readonly SessionGraphLayoutNode[],
  fromID: string,
  key: string,
): string {
  const direction = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key]
  if (!direction) return ""
  const from = nodes.find((item) => item.node.id === fromID)
  if (!from) return ""
  const center = (item: SessionGraphLayoutNode) => ({
    x: item.x + item.width / 2,
    y: item.y + item.height / 2,
  })
  const origin = center(from)
  let best = ""
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of nodes) {
    if (item.node.id === fromID) continue
    const target = center(item)
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const along = dx * direction[0] + dy * direction[1]
    if (along <= 0) continue
    const across = Math.abs(dx * direction[1]) + Math.abs(dy * direction[0])
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = item.node.id
    }
  }
  return best
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
  offsets: readonly number[],
  parents: ReadonlyMap<string, string[]>,
  centers: ReadonlyMap<string, number>,
) {
  const anchored = ordered.flatMap((node, slot) => {
    const center = barycenter(node, parents, centers)
    return center === undefined ? [] : [center - offsets[slot]]
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
