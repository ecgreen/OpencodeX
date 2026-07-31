import { describe, expect, test } from "bun:test"
import { buildNodePrompt, buildPlannerBrief, CHECK_INSTRUCTION } from "../../src/opencodex/goal-prompt"

const goal = { statement: "Ship the billing migration.", successCriteria: ["Tests pass", "No data loss"] }

describe("node prompt assembly", () => {
  test("layers the executor's definition, the goal, the task, then piped context", () => {
    const prompt = buildNodePrompt({
      skill: "You are a database migration specialist.",
      instructions: "Always write a rollback.",
      goal,
      node: { kind: "task", title: "Write the migration", brief: "Add the invoices table." },
      context: [{ title: "Survey the schema", result: "17 tables, 2 with foreign keys into invoices." }],
    })

    expect(prompt).toBe(
      [
        "You are a database migration specialist.",
        "",
        "Always write a rollback.",
        "",
        "# Goal",
        "Ship the billing migration.",
        "",
        "This goal is met when:",
        "- Tests pass",
        "- No data loss",
        "",
        "# Your task: Write the migration",
        "Add the invoices table.",
        "",
        "# Context from: Survey the schema",
        "17 tables, 2 with foreign keys into invoices.",
      ].join("\n"),
    )
  })

  test("omits every layer the node does not have", () => {
    const prompt = buildNodePrompt({
      goal: { statement: "Fix the flake." },
      node: { kind: "task", title: "Retry", brief: "Rerun the suite." },
    })
    expect(prompt).toBe("# Goal\nFix the flake.\n\n# Your task: Retry\nRerun the suite.")
  })

  test("drops context blocks whose upstream produced nothing", () => {
    const prompt = buildNodePrompt({
      goal: { statement: "x" },
      node: { kind: "task", title: "t", brief: "b" },
      context: [
        { title: "Empty", result: "   " },
        { title: "Real", result: "findings" },
      ],
    })
    expect(prompt).not.toContain("Empty")
    expect(prompt).toContain("# Context from: Real\nfindings")
  })

  test("a check is told the verdict contract, and to verify rather than trust", () => {
    const prompt = buildNodePrompt({
      goal,
      node: { kind: "check", title: "Tests pass", brief: "Run bun test." },
      context: [{ title: "Fix", result: "I fixed everything, trust me." }],
    })
    expect(prompt.endsWith(CHECK_INSTRUCTION)).toBe(true)
    expect(prompt).toContain("Do not take an upstream report's word for it")
    expect(prompt).toContain("When in doubt, fail")
  })

  test("only checks carry the verdict contract", () => {
    for (const kind of ["task", "synthesis"] as const) {
      expect(buildNodePrompt({ goal, node: { kind, title: "t", brief: "b" } })).not.toContain("StructuredOutput")
    }
  })

  test("an iteration tells the executor what to fix and not to start over", () => {
    const prompt = buildNodePrompt({
      goal,
      node: { kind: "task", title: "Patch", brief: "Fix failures." },
      iteration: { number: 2, maxIterations: 5, report: "2 tests fail.\n- auth.test.ts:44" },
    })
    expect(prompt).toContain("# Iteration 2 of at most 5")
    expect(prompt).toContain("Address this, do not start over:")
    expect(prompt).toContain("auth.test.ts:44")
  })

  test("iteration feedback comes after the task, so the model reads the job first", () => {
    const prompt = buildNodePrompt({
      goal,
      node: { kind: "check", title: "Verify", brief: "Check it." },
      context: [{ title: "Patch", result: "patched" }],
      iteration: { number: 2, maxIterations: 3, report: "still failing" },
    })
    expect(prompt.indexOf("# Your task")).toBeLessThan(prompt.indexOf("# Context from"))
    expect(prompt.indexOf("# Context from")).toBeLessThan(prompt.indexOf("# Iteration 2"))
    expect(prompt.indexOf("# Iteration 2")).toBeLessThan(prompt.indexOf(CHECK_INSTRUCTION))
  })
})

describe("planner brief", () => {
  test("hands a swarm planner its roster in the exact executor shape", () => {
    const brief = buildPlannerBrief({
      statement: "Ship the billing migration.",
      successCriteria: ["Tests pass"],
      roles: [{ name: "Backend", description: "server work" }, { name: "Reviewer" }],
    })
    expect(brief).toContain('{"type":"swarm_role","role":"<name>"}')
    expect(brief).toContain("- Backend: server work")
    expect(brief).toContain("- Reviewer")
    expect(brief).toContain("Success criteria:\n- Tests pass")
    expect(brief).not.toContain("Agents available")
  })

  test("a non-swarm planner is offered agents instead", () => {
    const brief = buildPlannerBrief({ statement: "Fix the flake.", agents: ["build", "explore"] })
    expect(brief).toContain('{"type":"agent","agent":"<name>"}')
    expect(brief).toContain("- explore")
    expect(brief).not.toContain("Executors available")
  })

  test("teaches the distinctions a planner actually gets wrong", () => {
    const brief = buildPlannerBrief({ statement: "x" })
    expect(brief).toContain("graph_plan tool")
    expect(brief).toContain("do not chain work that could be parallel")
    expect(brief).toContain("`feeds` edge when a node needs an upstream result")
    expect(brief).toContain("the check's findings feed the next pass")
  })
})
