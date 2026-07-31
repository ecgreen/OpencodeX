import { describe, expect, test } from "bun:test"
import {
  budgetBreach,
  cascadeSkipIDs,
  foldStatus,
  isStalled,
  loopOutcome,
  readyNodeIDs,
  validatePlan,
  type EdgeView,
  type GraphView,
  type NodeView,
} from "../../src/opencodex/goal-graph"
import type { EdgeInput, NodeInput, NodeKind, NodeStatus } from "../../src/opencodex/goal-schema"

/** A planner-authored node, defaulted so each test states only what it means. */
function plan(id: string, overrides: Partial<NodeInput> = {}): NodeInput {
  return {
    id,
    title: `Node ${id}`,
    brief: `Do ${id}`,
    executor: { type: "agent", agent: "build" },
    ...overrides,
  }
}

function edge(from: string, to: string, kind?: EdgeInput["kind"]): EdgeInput {
  return { from, to, ...(kind ? { kind } : {}) }
}

/** A live node, as the dispatcher sees it mid-run. */
function node(id: string, status: NodeStatus, overrides: Partial<NodeView> = {}): NodeView {
  return { id, kind: "task", status, title: `Node ${id}`, ...overrides }
}

function link(from: string, to: string, kind: EdgeView["kind"] = "requires"): EdgeView {
  return { fromNodeID: from, toNodeID: to, kind }
}

function graph(nodes: NodeView[], edges: EdgeView[] = []): GraphView {
  return { nodes, edges }
}

describe("plan validation", () => {
  test("accepts a fan-out plan that ends in synthesis and a check", () => {
    const issues = validatePlan({
      nodes: [
        plan("survey"),
        plan("api", { executor: { type: "swarm_role", role: "Backend" } }),
        plan("ui", { executor: { type: "swarm_role", role: "front end" } }),
        plan("merge", { kind: "synthesis" }),
        plan("verify", { kind: "check" }),
      ],
      edges: [
        edge("survey", "api"),
        edge("survey", "ui"),
        edge("api", "merge", "feeds"),
        edge("ui", "merge", "feeds"),
        edge("merge", "verify", "feeds"),
      ],
    }, { roles: ["Backend", "Front End"], agents: ["build"] })

    expect(issues).toEqual([])
  })

  test("reports every problem at once so one repair pass can fix them all", () => {
    const issues = validatePlan({
      nodes: [plan("a", { title: "  " }), plan("a"), plan("b", { brief: "" }), plan("!bad")],
      edges: [edge("a", "ghost")],
    })

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate node id "a"'),
        expect.stringContaining('Node "a" needs a title'),
        expect.stringContaining('Node "b" needs a brief'),
        expect.stringContaining('Node id "!bad"'),
        expect.stringContaining('unknown node "ghost"'),
      ]),
    )
  })

  test("rejects an empty plan", () => {
    expect(validatePlan({ nodes: [] })).toEqual(["A plan needs at least one node."])
  })

  test("names the roles and agents a planner may actually use", () => {
    const roleIssue = validatePlan(
      { nodes: [plan("a", { executor: { type: "swarm_role", role: "Archivist" } })] },
      { roles: ["Reviewer", "Builder"] },
    )
    expect(roleIssue).toEqual([
      'Node "a" names unknown swarm role "Archivist". Available: Reviewer, Builder.',
    ])

    // Role matching is lenient the same way delegation already is.
    expect(
      validatePlan(
        { nodes: [plan("a", { executor: { type: "swarm_role", role: "code_reviewer" } })] },
        { roles: ["Code Reviewer"] },
      ),
    ).toEqual([])

    expect(
      validatePlan({ nodes: [plan("a", { executor: { type: "agent", agent: "ghost" } })] }, { agents: ["build"] }),
    ).toEqual(['Node "a" names unknown agent "ghost". Available: build.'])
  })

  test("requires an executor on work, and forbids one on containers", () => {
    expect(validatePlan({ nodes: [plan("a", { executor: undefined })] })).toEqual(['Node "a" needs an executor.'])
    expect(validatePlan({ nodes: [plan("g", { kind: "gate", executor: { type: "agent", agent: "build" } })] })).toEqual([
      'Node "g" is a gate and cannot have an executor.',
    ])
    // A gate needs no executor: a human is the executor.
    expect(validatePlan({ nodes: [plan("g", { kind: "gate", executor: undefined })] })).toEqual([])
  })

  test("a bare model executor is legal, half a model pair is not", () => {
    expect(validatePlan({ nodes: [plan("a", { executor: { type: "model" } })] })).toEqual([])
    expect(
      validatePlan({ nodes: [plan("a", { executor: { type: "model", providerID: "anthropic" as never } })] }),
    ).toEqual(['Node "a" needs both providerID and modelID, or neither.'])
  })

  test("rejects dependency cycles and names the ring", () => {
    const issues = validatePlan({
      nodes: [plan("a"), plan("b"), plan("c")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("dependency cycle")
    expect(issues[0]).toContain("a")
  })

  test("rejects self-dependency", () => {
    expect(validatePlan({ nodes: [plan("a")], edges: [edge("a", "a")] })).toEqual([
      'Node "a" cannot depend on itself.',
    ])
  })

  describe("loops", () => {
    const loopPlan = (overrides: { nodes?: NodeInput[]; edges?: EdgeInput[] } = {}) => ({
      nodes: overrides.nodes ?? [
        plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests", maxIterations: 5 } }),
        plan("patch", { parentNodeID: "fix" }),
        plan("tests", { kind: "check", parentNodeID: "fix" }),
      ],
      edges: overrides.edges ?? [],
    })

    test("accepts a loop with body work and a check as its exit", () => {
      expect(validatePlan(loopPlan())).toEqual([])
    })

    test("rejects a loop with no exit check", () => {
      const issues = validatePlan({
        nodes: [plan("fix", { kind: "loop", executor: undefined }), plan("patch", { parentNodeID: "fix" })],
      })
      expect(issues).toEqual(['Loop "fix" needs a loop configuration naming its exit check.'])
    })

    test("rejects an exit check that is not a check, or not in the body", () => {
      expect(
        validatePlan({
          nodes: [
            plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "patch" } }),
            plan("patch", { parentNodeID: "fix" }),
          ],
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('which is a task and not a check')]))

      expect(
        validatePlan({
          nodes: [
            plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
            plan("patch", { parentNodeID: "fix" }),
            plan("tests", { kind: "check" }),
          ],
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining("not one of its body nodes")]))
    })

    test("rejects a loop whose only body node is its own check", () => {
      const issues = validatePlan({
        nodes: [
          plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
          plan("tests", { kind: "check", parentNodeID: "fix" }),
        ],
      })
      expect(issues).toEqual([
        'Loop "fix" has no body work; a loop that only checks can never change its own outcome.',
      ])
    })

    test("rejects nested loops and out-of-range iteration caps", () => {
      expect(
        validatePlan({
          nodes: [
            plan("outer", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "oc" } }),
            plan("oc", { kind: "check", parentNodeID: "outer" }),
            plan("inner", { kind: "loop", executor: undefined, parentNodeID: "outer", loop: { exitCheckNodeID: "ic" } }),
            plan("ic", { kind: "check", parentNodeID: "inner" }),
          ],
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining("nested loops are not supported")]))

      expect(
        validatePlan(
          loopPlan({
            nodes: [
              plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests", maxIterations: 0 } }),
              plan("patch", { parentNodeID: "fix" }),
              plan("tests", { kind: "check", parentNodeID: "fix" }),
            ],
          }),
        ),
      ).toEqual(expect.arrayContaining([expect.stringContaining("maxIterations between 1 and 50")]))
    })

    test("a body's own repetition is legal; a cycle inside one iteration is not", () => {
      const issues = validatePlan(
        loopPlan({
          nodes: [
            plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
            plan("patch", { parentNodeID: "fix" }),
            plan("lint", { parentNodeID: "fix" }),
            plan("tests", { kind: "check", parentNodeID: "fix" }),
          ],
          edges: [edge("patch", "lint"), edge("lint", "patch")],
        }),
      )
      expect(issues).toHaveLength(1)
      expect(issues[0]).toContain('Loop "fix" has a dependency cycle in its body')
    })

    test("nothing outside a loop may depend on a node that resets each iteration", () => {
      const issues = validatePlan(
        loopPlan({
          nodes: [
            plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
            plan("patch", { parentNodeID: "fix" }),
            plan("tests", { kind: "check", parentNodeID: "fix" }),
            plan("report"),
          ],
          edges: [edge("patch", "report", "feeds")],
        }),
      )
      expect(issues).toEqual([
        'Edge "patch" -> "report" leaves loop "fix"; depend on the loop node itself, whose result survives the iteration.',
      ])
    })

    test("a body node may read outside work only when the loop already waits for it", () => {
      const stalling = validatePlan(
        loopPlan({
          nodes: [
            plan("survey"),
            plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
            plan("patch", { parentNodeID: "fix" }),
            plan("tests", { kind: "check", parentNodeID: "fix" }),
          ],
          edges: [edge("survey", "patch", "feeds")],
        }),
      )
      expect(stalling).toEqual([
        expect.stringContaining('enters loop "fix", but the loop does not require "survey"'),
      ])

      // Adding the loop's own dependency on the same node makes it safe.
      expect(
        validatePlan(
          loopPlan({
            nodes: [
              plan("survey"),
              plan("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests" } }),
              plan("patch", { parentNodeID: "fix" }),
              plan("tests", { kind: "check", parentNodeID: "fix" }),
            ],
            edges: [edge("survey", "patch", "feeds"), edge("survey", "fix")],
          }),
        ),
      ).toEqual([])
    })
  })
})

describe("readiness", () => {
  test("dispatches every root at once - parallelism is the graph's shape", () => {
    const view = graph(
      [node("a", "planned"), node("b", "planned"), node("c", "planned")],
      [link("a", "c"), link("b", "c")],
    )
    expect(readyNodeIDs(view).toSorted()).toEqual(["a", "b"])
  })

  test("both edge kinds gate: you cannot pipe a result that does not exist yet", () => {
    const requires = graph([node("a", "running"), node("b", "planned")], [link("a", "b", "requires")])
    const feeds = graph([node("a", "running"), node("b", "planned")], [link("a", "b", "feeds")])
    expect(readyNodeIDs(requires)).toEqual([])
    expect(readyNodeIDs(feeds)).toEqual([])
  })

  test("only success satisfies a dependency", () => {
    for (const status of ["done", "failed", "skipped", "cancelled"] as const) {
      const view = graph([node("a", status), node("b", "planned")], [link("a", "b")])
      expect(readyNodeIDs(view)).toEqual(status === "done" ? ["b"] : [])
    }
  })

  test("a node already in flight is never handed out twice", () => {
    for (const status of ["ready", "dispatched", "running", "done"] as const) {
      expect(readyNodeIDs(graph([node("a", status)]))).toEqual([])
    }
  })

  test("loop body work waits for its loop to start iterating", () => {
    const nodes = [
      node("fix", "planned", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations: 3, iteration: 0 } }),
      node("patch", "planned", { parentNodeID: "fix" }),
      node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
    ]
    // The loop node itself is what becomes ready first.
    expect(readyNodeIDs(graph(nodes))).toEqual(["fix"])

    const running = [{ ...nodes[0]!, status: "running" as const }, nodes[1]!, nodes[2]!]
    expect(readyNodeIDs(graph(running))).toEqual(["patch"])
  })

  test("the exit check waits for the rest of the iteration, and skips a failed one", () => {
    const loop = node("fix", "running", {
      kind: "loop",
      loop: { exitCheckNodeID: "tests", maxIterations: 3, iteration: 1 },
    })
    const check = node("tests", "planned", { kind: "check", parentNodeID: "fix" })

    expect(readyNodeIDs(graph([loop, node("patch", "running", { parentNodeID: "fix" }), check]))).toEqual([])
    expect(readyNodeIDs(graph([loop, node("patch", "done", { parentNodeID: "fix" }), check]))).toEqual(["tests"])
    // A failed body node means the iteration is already lost; checking it would
    // burn a model call to learn what the runtime already knows.
    expect(readyNodeIDs(graph([loop, node("patch", "failed", { parentNodeID: "fix" }), check]))).toEqual([])
  })
})

describe("skip propagation", () => {
  test("one failure settles its whole downstream cone in a single pass", () => {
    const view = graph(
      [node("a", "failed"), node("b", "planned"), node("c", "planned"), node("d", "planned")],
      [link("a", "b"), link("b", "c"), link("c", "d")],
    )
    expect(cascadeSkipIDs(view).toSorted()).toEqual(["b", "c", "d"])
  })

  test("work on an independent branch keeps running", () => {
    const view = graph(
      [node("a", "failed"), node("b", "planned"), node("independent", "planned")],
      [link("a", "b")],
    )
    expect(cascadeSkipIDs(view)).toEqual(["b"])
  })

  test("settled nodes are left alone", () => {
    const view = graph([node("a", "failed"), node("b", "done")], [link("a", "b")])
    expect(cascadeSkipIDs(view)).toEqual([])
  })
})

describe("loop outcome", () => {
  const loopNode = (iteration: number, maxIterations = 3) =>
    node("fix", "running", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations, iteration } })

  test("waits while the iteration is still in flight", () => {
    const view = graph([
      loopNode(1),
      node("patch", "running", { parentNodeID: "fix" }),
      node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
    ])
    expect(loopOutcome(view, "fix")).toEqual({ type: "waiting" })
  })

  test("a passing exit check ends the loop", () => {
    const view = graph([
      loopNode(1),
      node("patch", "done", { parentNodeID: "fix" }),
      node("tests", "done", {
        kind: "check",
        parentNodeID: "fix",
        verdict: { pass: true, summary: "All 412 tests pass." },
      }),
    ])
    expect(loopOutcome(view, "fix")).toEqual({ type: "passed", report: "All 412 tests pass." })
  })

  test("a failing check feeds its findings into the next iteration", () => {
    const view = graph([
      loopNode(1),
      node("patch", "done", { parentNodeID: "fix" }),
      node("tests", "done", {
        kind: "check",
        parentNodeID: "fix",
        verdict: { pass: false, summary: "2 tests fail.", findings: ["auth.test.ts:44 expired token", "flaky retry"] },
      }),
    ])
    expect(loopOutcome(view, "fix")).toEqual({
      type: "continue",
      iteration: 2,
      report: "2 tests fail.\n- auth.test.ts:44 expired token\n- flaky retry",
    })
  })

  test("the iteration cap is an explicit exhaustion, never a quiet success", () => {
    const view = graph([
      loopNode(3, 3),
      node("patch", "done", { parentNodeID: "fix" }),
      node("tests", "done", {
        kind: "check",
        parentNodeID: "fix",
        verdict: { pass: false, summary: "Still 1 failing test." },
      }),
    ])
    expect(loopOutcome(view, "fix")).toEqual({ type: "exhausted", report: "Still 1 failing test." })
  })

  test("a body failure retries the whole iteration with the failure as feedback", () => {
    const view = graph([
      loopNode(1),
      node("patch", "failed", { parentNodeID: "fix", failureReason: "patch did not apply", title: "Apply patch" }),
      node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
    ])
    expect(loopOutcome(view, "fix")).toEqual({
      type: "continue",
      iteration: 2,
      report: 'Body node "Apply patch" failed: patch did not apply',
    })
  })

  test("a check that never returned a verdict is a failure, not an exit", () => {
    for (const status of ["failed", "skipped", "cancelled"] as const) {
      const view = graph([
        loopNode(1),
        node("patch", "done", { parentNodeID: "fix" }),
        node("tests", status, { kind: "check", parentNodeID: "fix", failureReason: "model errored" }),
      ])
      expect(loopOutcome(view, "fix")).toEqual({ type: "continue", iteration: 2, report: "model errored" })
    }

    // Done, but with no verdict at all: still not a pass.
    const silent = graph([
      loopNode(1),
      node("patch", "done", { parentNodeID: "fix" }),
      node("tests", "done", { kind: "check", parentNodeID: "fix" }),
    ])
    expect(loopOutcome(silent, "fix")).toEqual({
      type: "continue",
      iteration: 2,
      report: "Exit check did not return a verdict.",
    })
  })
})

describe("status folding", () => {
  const cases: [string, NodeStatus[], string][] = [
    ["work remains", ["done", "planned"], "running"],
    ["everything landed", ["done", "done"], "completed"],
    ["one node failed", ["done", "failed"], "failed"],
    ["skips alone do not fail a goal", ["done", "skipped"], "completed"],
  ]
  for (const [name, statuses, expected] of cases) {
    test(name, () => {
      expect(foldStatus(graph(statuses.map((status, index) => node(`n${index}`, status))))).toBe(expected as never)
    })
  }

  test("a gate outranks running work, because a human is the blocker", () => {
    expect(foldStatus(graph([node("a", "running"), node("g", "awaiting_approval", { kind: "gate" })]))).toBe("blocked")
  })
})

describe("stall detection", () => {
  test("a graph with ready work is not stalled", () => {
    expect(isStalled(graph([node("a", "planned")]))).toBe(false)
  })

  test("a graph that is entirely settled is not stalled", () => {
    expect(isStalled(graph([node("a", "done"), node("b", "skipped")]))).toBe(false)
  })

  test("a dangling dependency settles as a skip rather than a stall", () => {
    // "b" waits on a node that does not exist. Validation makes this
    // unreachable, but if it happens the cascade settles it instead of hanging.
    const view = graph([node("b", "planned")], [link("ghost", "b")])
    expect(cascadeSkipIDs(view)).toEqual(["b"])
    expect(isStalled(view)).toBe(false)
  })

  test("work that nothing can advance and nothing can skip is a stall", () => {
    // A loop body whose loop is already done: not ready (the loop is not
    // running), not skippable (its dependencies are fine), and nobody is
    // coming. The dispatcher fails the goal instead of waiting forever.
    const view = graph([
      node("fix", "done", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations: 1, iteration: 1 } }),
      node("orphan", "planned", { parentNodeID: "fix" }),
    ])
    expect(readyNodeIDs(view)).toEqual([])
    expect(cascadeSkipIDs(view)).toEqual([])
    expect(isStalled(view)).toBe(true)
  })
})

describe("budget", () => {
  const spend = { nodeRuns: 4, costUsd: 1.5 }

  test("no budget never trips", () => {
    expect(budgetBreach({ spend, now: 1_000, startedAt: 0 })).toBeUndefined()
  })

  test("each dimension trips on its own and says which", () => {
    expect(budgetBreach({ budget: { maxNodeRuns: 4 }, spend, now: 0 })).toContain("Node run budget")
    expect(budgetBreach({ budget: { maxNodeRuns: 5 }, spend, now: 0 })).toBeUndefined()
    expect(budgetBreach({ budget: { maxCostUsd: 1.5 }, spend, now: 0 })).toContain("Cost budget")
    expect(budgetBreach({ budget: { maxWallClockMs: 1_000 }, spend, startedAt: 0, now: 1_000 })).toContain(
      "Wall-clock budget",
    )
    expect(budgetBreach({ budget: { maxWallClockMs: 1_000 }, spend, startedAt: 0, now: 999 })).toBeUndefined()
  })

  test("a wall clock cannot trip before the goal starts", () => {
    expect(budgetBreach({ budget: { maxWallClockMs: 1 }, spend, now: 10_000 })).toBeUndefined()
  })
})

describe("kind coverage", () => {
  test("every node kind is either executable or a container, and validation knows which", () => {
    const kinds: NodeKind[] = ["task", "check", "loop", "synthesis", "gate"]
    for (const kind of kinds) {
      const withExecutor = validatePlan({
        nodes: [
          plan("n", {
            kind,
            ...(kind === "loop" ? { loop: { exitCheckNodeID: "c" } } : {}),
          }),
          ...(kind === "loop" ? [plan("c", { kind: "check", parentNodeID: "n" }), plan("w", { parentNodeID: "n" })] : []),
        ],
      })
      const executable = ["task", "check", "synthesis"].includes(kind)
      expect(withExecutor.some((issue) => issue.includes("cannot have an executor"))).toBe(!executable)
    }
  })
})
