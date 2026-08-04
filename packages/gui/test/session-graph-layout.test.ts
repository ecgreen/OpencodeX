import { describe, expect, test } from "bun:test"
import { sessionGraphStructure, type SessionGraph, type SessionGraphNode } from "../src/renderer/src/lib/session-graph"
import {
  GRAPH_COLUMN_GAP,
  GRAPH_GATE_ROW_HEIGHT,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutSessionGraph,
  paddedBounds,
  sessionGraphLayoutNode,
  spatialGraphNeighbor,
} from "../src/renderer/src/lib/session-graph-layout"
import {
  centerGraphViewport,
  clampGraphScale,
  clampGraphViewportPan,
  clientPointFromGraph,
  fitGraphViewport,
  frameGraphViewport,
  graphNodeVisible,
  graphPointFromClient,
  graphTransform,
  offscreenGraphSummary,
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  READABLE_GRAPH_SCALE,
  panGraphViewport,
  wheelZoomFactor,
  zoomGraphViewportAt,
} from "../src/renderer/src/lib/session-graph-viewport"

describe("session graph layout", () => {
  test("puts each depth in its own column", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:2"]))
    const columns = layout.nodes.map((item) => item.x)
    expect(columns[0]).toBe(0)
    expect(columns[1]).toBe(GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP)
    expect(columns[2]).toBe((GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP) * 2)
  })

  test("stacks siblings without overlapping", () => {
    const layout = layoutSessionGraph(graph(["a:0", "b:1", "c:1", "d:1"]))
    const children = layout.nodes.filter((item) => item.node.depth === 1).map((item) => item.y).sort((l, r) => l - r)
    for (const [index, y] of children.entries()) {
      if (index === 0) continue
      expect(y - children[index - 1]).toBeGreaterThanOrEqual(GRAPH_NODE_HEIGHT)
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
    const edge = layout.edges[0]
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
    expect(layout.bounds.width).toBe(GRAPH_NODE_WIDTH * 2 + GRAPH_COLUMN_GAP)
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

  test("orders nodes in spatial reading order for the tab sequence", () => {
    const layout = layoutSessionGraph(graph(["a:0", "c:1", "b:1"]))
    const order = layout.nodes.map((item) => item.node.id)
    // Column first, then top to bottom inside the column.
    expect(order[0]).toBe("a")
    const [first, second] = layout.nodes.slice(1)
    expect(first.y).toBeLessThanOrEqual(second.y)
  })
})

describe("approval gate geometry", () => {
  const gated = (id: string, depth: number): SessionGraphNode => ({
    id,
    kind: "session",
    sessionID: id,
    depth,
    title: id,
    status: "input_needed",
    statusLabel: "Needs your approval",
    gate: { goalID: "goal-1", nodeID: id },
    updatedAt: 0,
    root: false,
  })

  const withNodes = (nodes: SessionGraphNode[], edges: readonly (readonly [string, string])[]): SessionGraph => ({
    ...graph([]),
    rootID: nodes[0]?.id ?? "",
    rootSessionID: nodes[0]?.id ?? "",
    nodes,
    edges: edges.map(([from, to]) => ({
      id: `${from}->${to}`,
      from,
      to,
      label: to,
      detail: to,
      status: "idle" as const,
      provenance: "observed_spawn" as const,
    })),
  })

  test("a gated node reserves its action row in layout height", () => {
    const source = withNodes([plain("root", 0), gated("gate", 1)], [["root", "gate"]])
    const layout = layoutSessionGraph(source)
    expect(sessionGraphLayoutNode(layout, "gate")?.height).toBe(GRAPH_NODE_HEIGHT + GRAPH_GATE_ROW_HEIGHT)
    expect(sessionGraphLayoutNode(layout, "root")?.height).toBe(GRAPH_NODE_HEIGHT)
  })

  test("two gated siblings in one layer do not overlap", () => {
    const source = withNodes(
      [plain("root", 0), gated("gate-a", 1), gated("gate-b", 1)],
      [
        ["root", "gate-a"],
        ["root", "gate-b"],
      ],
    )
    const layout = layoutSessionGraph(source)
    const [top, bottom] = [sessionGraphLayoutNode(layout, "gate-a")!, sessionGraphLayoutNode(layout, "gate-b")!]
      .toSorted((left, right) => left.y - right.y)
    expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height)
  })

  test("a gate on the last row stays inside the layout bounds", () => {
    const source = withNodes(
      [plain("root", 0), plain("step", 1), gated("gate", 1)],
      [
        ["root", "step"],
        ["root", "gate"],
      ],
    )
    const layout = layoutSessionGraph(source)
    for (const node of layout.nodes) {
      expect(node.y + node.height).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.height)
    }
    // Fit-to-view frames paddedBounds, so containment in bounds is containment
    // on screen; the gate's action row is inside what fit will show.
    const padded = paddedBounds(layout.bounds)
    const gate = sessionGraphLayoutNode(layout, "gate")!
    expect(gate.y + gate.height).toBeLessThanOrEqual(padded.y + padded.height)
  })

  function plain(id: string, depth: number): SessionGraphNode {
    return {
      id,
      kind: "session",
      sessionID: id,
      depth,
      title: id,
      status: "idle",
      statusLabel: "Idle",
      updatedAt: 0,
      root: depth === 0,
    }
  }
})

describe("spatial keyboard navigation", () => {
  /** A 2x2-ish layout: root, two children (one a job, one a merge), a sentinel. */
  const mixed = (): SessionGraph => ({
    ...graph([]),
    rootID: "root",
    rootSessionID: "root",
    nodes: [
      { id: "root", kind: "session", sessionID: "root", depth: 0, title: "root", status: "idle", statusLabel: "Idle", updatedAt: 0, root: true },
      { id: "job", kind: "job", depth: 1, title: "queued job", status: "queued", statusLabel: "Queued", updatedAt: 0, root: false },
      { id: "child", kind: "session", sessionID: "child", depth: 1, title: "child", status: "running", statusLabel: "Running", updatedAt: 0, root: false },
      { id: "join", kind: "join", sessionID: "root", depth: 2, title: "Merge results", status: "queued", statusLabel: "Waiting on branches", updatedAt: 0, root: false },
      { id: "sentinel", kind: "sentinel", depth: 2, title: "Descendants not checked", status: "idle", statusLabel: "Not checked", updatedAt: 0, root: false },
    ],
    edges: [],
  })

  test("every node kind is a navigation target - none can strand focus", () => {
    const layout = layoutSessionGraph(mixed())
    // Right from the root reaches the first column, whatever kind it holds.
    const first = spatialGraphNeighbor(layout.nodes, "root", "ArrowRight")
    expect(["job", "child"]).toContain(first)
    // Vertical movement between a job node and a session node works both ways
    // - the review's dead end was an arrow key targeting a disabled job card.
    const jobY = sessionGraphLayoutNode(layout, "job")!.y
    const childY = sessionGraphLayoutNode(layout, "child")!.y
    const upper = jobY < childY ? "job" : "child"
    const lower = jobY < childY ? "child" : "job"
    expect(spatialGraphNeighbor(layout.nodes, upper, "ArrowDown")).toBe(lower)
    expect(spatialGraphNeighbor(layout.nodes, lower, "ArrowUp")).toBe(upper)
    // Merges and sentinels are reachable and escapable in all four directions.
    const fromChild = spatialGraphNeighbor(layout.nodes, "child", "ArrowRight")
    expect(["join", "sentinel"]).toContain(fromChild)
    expect(spatialGraphNeighbor(layout.nodes, fromChild, "ArrowLeft")).toBeTruthy()
  })

  test("an unknown key or origin navigates nowhere", () => {
    const layout = layoutSessionGraph(mixed())
    expect(spatialGraphNeighbor(layout.nodes, "root", "Enter")).toBe("")
    expect(spatialGraphNeighbor(layout.nodes, "ghost", "ArrowRight")).toBe("")
  })
})

describe("graph structural identity", () => {
  test("status churn does not change the structure; shape and identity do", () => {
    const base = graph(["a:0", "b:1"])
    const busy: SessionGraph = {
      ...base,
      nodes: base.nodes.map((node) => ({ ...node, status: "running" as const, statusLabel: "Running" })),
    }
    expect(sessionGraphStructure(busy)).toBe(sessionGraphStructure(base))

    // Same node count, different node: a different graph.
    const swapped = graph(["a:0", "c:1"])
    expect(sessionGraphStructure(swapped)).not.toBe(sessionGraphStructure(base))

    // Same node count, new depth: also a different graph.
    const deepened = graph(["a:0", "b:2"])
    expect(sessionGraphStructure(deepened)).not.toBe(sessionGraphStructure(base))
  })

  test("a gate appearing on an unchanged node changes the structure", () => {
    // The gate row changes the node's drawn height, so an untouched viewport
    // must re-frame even though ids, depths, and edges are identical.
    const base = graph(["a:0", "b:1"])
    const gated: SessionGraph = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "b" ? { ...node, gate: { goalID: "goal-1", nodeID: "b" } } : node,
      ),
    }
    expect(sessionGraphStructure(gated)).not.toBe(sessionGraphStructure(base))
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

describe("readable automatic framing", () => {
  const wide = { x: 0, y: 0, width: 6000, height: 400 }
  const size = { width: 800, height: 600 }

  test("automatic framing never drops below the readable floor", () => {
    // Plain fit would go to ~0.13 for this graph; the frame holds the floor.
    expect(fitGraphViewport(wide, size).scale).toBeLessThan(READABLE_GRAPH_SCALE)
    expect(frameGraphViewport(wide, size).scale).toBe(READABLE_GRAPH_SCALE)
  })

  test("the floor frame centres the focus box", () => {
    const focus = { x: 5000, y: 100, width: 212, height: 76 }
    const viewport = frameGraphViewport(wide, size, focus)
    const center = clientPointFromGraph(viewport, {
      x: focus.x + focus.width / 2,
      y: focus.y + focus.height / 2,
    })
    expect(center.x).toBeCloseTo(size.width / 2, 6)
    expect(center.y).toBeCloseTo(size.height / 2, 6)
    expect(graphNodeVisible(viewport, focus, size)).toBe(true)
  })

  test("a graph that fits readably is framed whole, exactly as fit would", () => {
    const small = { x: 0, y: 0, width: 500, height: 300 }
    expect(frameGraphViewport(small, size)).toEqual(fitGraphViewport(small, size))
  })

  test("manual fit stays unrestricted - the floor is automatic-only", () => {
    expect(fitGraphViewport(wide, size).scale).toBeGreaterThanOrEqual(GRAPH_MIN_SCALE)
    expect(fitGraphViewport(wide, size).scale).toBeLessThan(READABLE_GRAPH_SCALE)
  })
})

describe("offscreen work summary", () => {
  const size = { width: 400, height: 300 }
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 })

  test("counts hidden nodes by the edge they lie past, attention separately", () => {
    const summary = offscreenGraphSummary(
      [
        { box: box(50, 50), attention: false },
        { box: box(-500, 50), attention: true },
        { box: box(900, 50), attention: false },
        { box: box(900, 60), attention: true },
        { box: box(50, 900), attention: false },
      ],
      { x: 0, y: 0, scale: 1 },
      size,
    )
    expect(summary.left).toEqual({ count: 1, attention: 1 })
    expect(summary.right).toEqual({ count: 2, attention: 1 })
    expect(summary.down).toEqual({ count: 1, attention: 0 })
    expect(summary.up).toEqual({ count: 0, attention: 0 })
  })

  test("a partially visible card is on screen, not 'more work over there'", () => {
    // Straddling the left edge, the bottom edge, and one card fully inside:
    // none of them may inflate the counts - this was the "numbers way off at
    // some zoom settings" bug, where edge-straddling cards were counted and
    // dumped into the wrong bucket.
    const summary = offscreenGraphSummary(
      [
        { box: box(-50, 50), attention: true },
        { box: box(50, 280), attention: false },
        { box: box(390, 50), attention: false },
        { box: box(10, 10), attention: true },
      ],
      { x: 0, y: 0, scale: 1 },
      size,
    )
    expect(summary.left.count + summary.right.count + summary.up.count + summary.down.count).toBe(0)
  })

  test("classification respects zoom - the client box decides, not graph units", () => {
    // At 0.5x, a node at graph x=900 sits at client x=450: past the right
    // edge of a 400px pane. At 1x a node at graph x=500 straddles nothing.
    const summary = offscreenGraphSummary(
      [{ box: box(900, 50), attention: false }],
      { x: 0, y: 0, scale: 0.5 },
      size,
    )
    expect(summary.right.count).toBe(1)
  })

  test("a fully visible graph reports nothing offscreen", () => {
    const summary = offscreenGraphSummary(
      [{ box: box(10, 10), attention: true }],
      { x: 0, y: 0, scale: 1 },
      size,
    )
    expect(summary.left.count + summary.right.count + summary.up.count + summary.down.count).toBe(0)
  })
})

describe("bounded panning", () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 600 }
  const size = { width: 400, height: 300 }

  test("a pan inside the 2x world is untouched", () => {
    const viewport = { x: -100, y: -50, scale: 1 }
    expect(clampGraphViewportPan(viewport, bounds, size)).toEqual(viewport)
  })

  test("dragging the graph into the void stops at the world edge", () => {
    // World spans x in [-500, 1500]. A viewport window starting at graph
    // x=4000 is far past it; the clamp parks the window at the world's right
    // edge (x = 1500 - 400 = 1100), keeping the graph one pan away.
    const runaway = clampGraphViewportPan({ x: -4000, y: 0, scale: 1 }, bounds, size)
    expect(runaway.x).toBe(-1100)
    // And symmetrically at the left/top edges.
    const leftward = clampGraphViewportPan({ x: 4000, y: 4000, scale: 1 }, bounds, size)
    expect(leftward.x).toBe(500)
    expect(leftward.y).toBe(300)
  })

  test("zoomed far out, the graph centres instead of wandering", () => {
    // At 0.1x the visible window is 4000x3000 graph units - larger than the
    // 2000x1200 world - so both axes lock to centre and dragging does nothing.
    const clamped = clampGraphViewportPan({ x: 999, y: -999, scale: 0.1 }, bounds, size)
    const again = clampGraphViewportPan({ x: -5, y: 5, scale: 0.1 }, bounds, size)
    expect(clamped).toEqual(again)
  })

  test("an unmeasured pane or empty graph never clamps", () => {
    const viewport = { x: 123, y: 456, scale: 1 }
    expect(clampGraphViewportPan(viewport, { x: 0, y: 0, width: 0, height: 0 }, size)).toEqual(viewport)
    expect(clampGraphViewportPan(viewport, bounds, { width: 0, height: 0 })).toEqual(viewport)
  })
})

/** `id:depth` shorthand; edges default to a chain from each node to the next depth. */
function graph(specs: readonly string[], edges?: readonly (readonly [string, string])[]): SessionGraph {
  const nodes = specs.map((spec): SessionGraphNode => {
    const [id, depth] = spec.split(":")
    return {
      id,
      kind: "session",
      sessionID: id,
      depth: Number(depth),
      title: id,
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
      provenance: "observed_spawn" as const,
    })),
    counts: {
      total: nodes.length,
      delegated: Math.max(0, nodes.length - 1),
      running: 0,
      retrying: 0,
      queued: 0,
      blocked: 0,
      needsReview: 0,
      completed: 0,
      returned: 0,
      failed: 0,
      cancelled: 0,
    },
  }
}

function defaultEdges(nodes: readonly SessionGraphNode[]) {
  return nodes.flatMap((node) => {
    if (node.depth === 0) return []
    const parent = nodes.find((item) => item.depth === node.depth - 1)
    return parent ? [[parent.id, node.id] as const] : []
  })
}
