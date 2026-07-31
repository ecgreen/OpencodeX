import { describe, expect, test } from "bun:test"
import type { SessionGraph, SessionGraphNode } from "../src/renderer/src/lib/session-graph"
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutSessionGraph,
  paddedBounds,
  sessionGraphLayoutNode,
} from "../src/renderer/src/lib/session-graph-layout"
import {
  centerGraphViewport,
  clampGraphScale,
  clientPointFromGraph,
  fitGraphViewport,
  graphNodeVisible,
  graphPointFromClient,
  graphTransform,
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  panGraphViewport,
  wheelZoomFactor,
  zoomGraphViewportAt,
} from "../src/renderer/src/lib/session-graph-viewport"

describe("session graph layout", () => {
  test("puts each depth in its own column", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:2"]))
    const columns = layout.nodes.map((item) => item.x)
    expect(columns[0]).toBe(0)
    expect(columns[1]).toBe(GRAPH_NODE_WIDTH + 76)
    expect(columns[2]).toBe((GRAPH_NODE_WIDTH + 76) * 2)
  })

  test("stacks siblings without overlapping", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:1", "d:1"]))
    const children = layout.nodes.filter((item) => item.node.depth === 1).map((item) => item.y).sort((l, r) => l - r)
    for (const [index, y] of children.entries()) {
      if (index === 0) continue
      expect(y - children[index - 1]!).toBeGreaterThanOrEqual(GRAPH_NODE_HEIGHT)
    }
  })

  test("is deterministic: the same graph lays out identically every time", () => {
    const source = graph(["a:0", "b:1", "c:1", "d:2", "e:2"])
    expect(layoutSessionGraph(source)).toEqual(layoutSessionGraph(source))
  })

  test("centres a column on the parents it hangs from", () => {
    // Two children under `a`, then one grandchild under the second child: the
    // grandchild should sit opposite its parent rather than at the top slot.
    const source = graph(["a:0", "b:1", "c:1", "d:2"], [["a", "b"], ["a", "c"], ["c", "d"]])
    const layout = layoutSessionGraph(source)
    expect(sessionGraphLayoutNode(layout, "d")?.y).toBe(sessionGraphLayoutNode(layout, "c")?.y)
  })

  test("draws an edge from the parent's right edge to the child's left edge", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1"]))
    const edge = layout.edges[0]!
    const from = sessionGraphLayoutNode(layout, "a")!
    const to = sessionGraphLayoutNode(layout, "b")!
    expect(edge.path.startsWith(`M ${from.x + from.width} ${from.y + from.height / 2} C`)).toBe(true)
    expect(edge.path.endsWith(`${to.x} ${to.y + to.height / 2}`)).toBe(true)
    expect(edge.labelX).toBe(Math.round((from.x + from.width + to.x) / 2))
  })

  test("skips an edge whose endpoint is missing rather than drawing to nowhere", () => {
    const source = graph(["a:0"], [["a", "ghost"]])
    expect(layoutSessionGraph(source).edges).toEqual([])
  })

  test("bounds cover every node and pad outwards", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:1"]))
    expect(layout.bounds.width).toBe(GRAPH_NODE_WIDTH * 2 + 76)
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(layout.bounds.x)
      expect(node.y).toBeGreaterThanOrEqual(layout.bounds.y)
      expect(node.x + node.width).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.width)
      expect(node.y + node.height).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.height)
    }
    expect(paddedBounds(layout.bounds)).toEqual({
      x: layout.bounds.x - 40,
      y: layout.bounds.y - 40,
      width: layout.bounds.width + 80,
      height: layout.bounds.height + 80,
    })
  })

  test("returns the empty layout for the empty graph", () => {
    expect(layoutSessionGraph(graph([])).nodes).toEqual([])
  })
})

describe("session graph viewport", () => {
  test("clamps zoom to the supported range", () => {
    expect(clampGraphScale(0.01)).toBe(GRAPH_MIN_SCALE)
    expect(clampGraphScale(99)).toBe(GRAPH_MAX_SCALE)
    expect(clampGraphScale(Number.NaN)).toBe(1)
  })

  test("keeps the point under the cursor fixed while zooming", () => {
    const viewport = { x: 30, y: -10, scale: 1 }
    const focus = { x: 400, y: 220 }
    const before = graphPointFromClient(viewport, focus)
    const after = graphPointFromClient(zoomGraphViewportAt(viewport, focus, 1.6), focus)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
  })

  test("does not slide the canvas when a zoom is refused at the limit", () => {
    const viewport = { x: 12, y: 8, scale: GRAPH_MAX_SCALE }
    expect(zoomGraphViewportAt(viewport, { x: 100, y: 100 }, 2)).toEqual(viewport)
  })

  test("round-trips between graph and client coordinates", () => {
    const viewport = { x: -64, y: 25, scale: 1.75 }
    const point = { x: 321, y: 87 }
    const returned = graphPointFromClient(viewport, clientPointFromGraph(viewport, point))
    expect(returned.x).toBeCloseTo(point.x, 8)
    expect(returned.y).toBeCloseTo(point.y, 8)
  })

  test("pans by the raw delta, independent of zoom", () => {
    expect(panGraphViewport({ x: 10, y: 10, scale: 2 }, -5, 7)).toEqual({ x: 5, y: 17, scale: 2 })
  })

  test("wheel direction decides zoom in or out, and the factor stays bounded", () => {
    expect(wheelZoomFactor(-120)).toBeGreaterThan(1)
    expect(wheelZoomFactor(120)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(-100000)).toBeLessThanOrEqual(1.2)
  })

  test("fit frames the whole graph inside the pane", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:1"]))
    const size = { width: 400, height: 300 }
    const viewport = fitGraphViewport(layout.bounds, size)
    for (const node of layout.nodes) {
      const topLeft = clientPointFromGraph(viewport, { x: node.x, y: node.y })
      const bottomRight = clientPointFromGraph(viewport, { x: node.x + node.width, y: node.y + node.height })
      expect(topLeft.x).toBeGreaterThanOrEqual(0)
      expect(topLeft.y).toBeGreaterThanOrEqual(0)
      expect(bottomRight.x).toBeLessThanOrEqual(size.width)
      expect(bottomRight.y).toBeLessThanOrEqual(size.height)
    }
  })

  test("fit never magnifies a small graph past 1:1", () => {
    const layout = layoutSessionGraph(graph(["a:0"]))
    expect(fitGraphViewport(layout.bounds, { width: 4000, height: 3000 }).scale).toBe(1)
  })

  test("fit is inert without a measured pane", () => {
    expect(fitGraphViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    })
  })

  test("centring puts the node in the middle and reports it visible", () => {
    const size = { width: 600, height: 400 }
    const target = { x: 900, y: 700, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
    const viewport = centerGraphViewport({ x: 0, y: 0, scale: 1 }, target, size)
    expect(graphNodeVisible(viewport, target, size)).toBe(true)
    expect(clientPointFromGraph(viewport, { x: target.x + target.width / 2, y: target.y + target.height / 2 })).toEqual({
      x: 300,
      y: 200,
    })
  })

  test("reports an off-screen node as not visible", () => {
    const size = { width: 600, height: 400 }
    expect(graphNodeVisible({ x: 0, y: 0, scale: 1 }, { x: 5000, y: 0, width: 100, height: 40 }, size)).toBe(false)
  })

  test("renders a CSS transform for the scene layer", () => {
    expect(graphTransform({ x: 12.3456, y: -7.891, scale: 1.23456 })).toBe(
      "translate(12.35px, -7.89px) scale(1.2346)",
    )
  })
})

/** `id:depth` shorthand; edges default to a chain from each node to the next depth. */
function graph(specs: readonly string[], edges?: readonly (readonly [string, string])[]): SessionGraph {
  const nodes = specs.map((spec): SessionGraphNode => {
    const [id, depth] = spec.split(":")
    return {
      id: id!,
      kind: "session",
      sessionID: id,
      depth: Number(depth),
      title: id!,
      status: "idle",
      statusLabel: "Idle",
      updatedAt: 0,
      root: Number(depth) === 0,
    }
  })
  const links = edges ?? defaultEdges(nodes)
  return {
    rootID: nodes[0]?.id ?? "",
    rootSessionID: nodes[0]?.id ?? "",
    nodes,
    edges: links.map(([from, to]) => ({
      id: `${from}->${to}`,
      from,
      to,
      label: to,
      detail: to,
      status: "idle" as const,
    })),
    counts: { total: nodes.length, running: 0, completed: 0, failed: 0, blocked: 0 },
  }
}

function defaultEdges(nodes: readonly SessionGraphNode[]) {
  return nodes.flatMap((node) => {
    if (node.depth === 0) return []
    const parent = nodes.find((item) => item.depth === node.depth - 1)
    return parent ? [[parent.id, node.id] as const] : []
  })
}
