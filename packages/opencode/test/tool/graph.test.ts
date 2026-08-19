import { describe, expect } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Agent } from "@/agent/agent"
import { OpencodeXGoal } from "@/opencodex/goal"
import { OpencodeXProject } from "@/opencodex/project"
import { MessageID, SessionID } from "@/session/schema"
import { GraphPlanTool } from "@/tool/graph"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const sessionID = SessionID.make("ses_graph_plan_tool")
const directory = "/tmp/graph-plan-tool"
const created: OpencodeXGoal.CreateInput[] = []
const planned: OpencodeXGoal.PlanInput[] = []
const contexts: ({ swarmID?: string | null; directory?: string } | undefined)[] = []
const started: string[] = []
let listed: OpencodeXGoal.Info[] = []

const goal = (
  status: OpencodeXGoal.Status = "draft",
  context?: { swarmID?: string; directory?: string },
): OpencodeXGoal.Info => ({
  id: "goal-1",
  projectID: "project-1",
  title: "Dispatch context",
  statement: "Verify graph dispatch context",
  successCriteria: [],
  status,
  source: "manual",
  ownerSessionID: sessionID,
  swarmID: context?.swarmID,
  directory: context?.directory,
  spend: { nodeRuns: 0, costUsd: 0 },
  nodes: [],
  edges: [],
  timeCreated: 1,
  timeUpdated: 1,
})

const goals = Layer.mock(OpencodeXGoal.Service)({
  list: () => Effect.sync(() => listed),
  create: (input) => Effect.sync(() => (created.push(input), goal())),
  plan: (_goalID, input, context) =>
    Effect.sync(() => (planned.push(input), contexts.push(context), goal("planned"))),
  start: (goalID) => Effect.sync(() => (started.push(goalID), goal("running"))),
})
const projects = Layer.mock(OpencodeXProject.Service)({
  list: () =>
    Effect.succeed([
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- projectForSession only reads these fields
      {
        id: "project-1",
        project: { id: "project-1", worktree: directory, vcs: "git", time: { created: 1, updated: 1 } },
        folders: [],
        sessions: [{ id: sessionID }],
        terminalSessions: [],
      } as unknown as OpencodeXProject.Info,
    ]),
})
const agents = Layer.mock(Agent.Service)({
  get: () => Effect.succeed({ name: "build", mode: "primary", permission: [], options: {} }),
})
const truncate = Layer.mock(Truncate.Service)({
  output: (text) => Effect.succeed({ content: text, truncated: false }),
})
const it = testEffect(Layer.mergeAll(goals, projects, agents, truncate))

function userMessage(id: string, providerID: string, modelID: string): SessionLegacy.WithParts {
  return {
    info: {
      id: MessageID.make(id),
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: ProviderV2.ID.make(providerID), modelID: ProviderV2.ModelID.make(modelID) },
    },
    parts: [],
  }
}

function context(messages: SessionLegacy.WithParts[], model?: { providerID: string; modelID: string }): Tool.Context {
  return {
    sessionID,
    directory,
    messageID: MessageID.make("msg_graph_plan_tool"),
    agent: "build",
    abort: new AbortController().signal,
    messages,
    extra: model ? { model } : undefined,
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

const params = {
  goal: "Verify graph dispatch context",
  wait: false,
  nodes: [
    {
      id: "root",
      title: "Root",
      brief: "Run at the root",
      kind: "task" as const,
      parentNodeID: "  ",
      loop: { exitCheckNodeID: "ignored", maxIterations: 9 },
    },
    {
      id: "repeat",
      title: "Repeat",
      brief: "Repeat until verified",
      kind: "loop" as const,
      loop: { exitCheckNodeID: "check", maxIterations: 4 },
    },
  ],
}

describe("graph_plan", () => {
  it.effect("passes normalized dispatch context through execute", () =>
    Effect.gen(function* () {
      created.length = 0
      planned.length = 0
      contexts.length = 0
      started.length = 0
      listed = []
      const tool = yield* Tool.init(yield* GraphPlanTool)

      yield* tool.execute(
        params,
        context([userMessage("msg_001", "swarm", "older-swarm"), userMessage("msg_002", "openai", "gpt-5")], {
          providerID: "swarm",
          modelID: "direct-swarm",
        }),
      )

      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ directory, swarmID: "direct-swarm", ownerSessionID: sessionID })
      expect(planned).toHaveLength(1)
      expect(planned[0].nodes).toEqual([
        expect.objectContaining({ id: "root", parentNodeID: undefined, loop: undefined }),
        expect.objectContaining({ id: "repeat", loop: { exitCheckNodeID: "check", maxIterations: 4 } }),
      ])
      expect(started).toEqual(["goal-1"])
      expect(contexts).toEqual([{ swarmID: "direct-swarm", directory }])
    }),
  )

  it.effect("uses only the latest persisted user model for swarm fallback", () =>
    Effect.gen(function* () {
      created.length = 0
      listed = []
      const tool = yield* Tool.init(yield* GraphPlanTool)

      yield* tool.execute(params, context([userMessage("msg_002", "swarm", "persisted-swarm")]))
      yield* tool.execute(
        params,
        context([userMessage("msg_002", "anthropic", "claude"), userMessage("msg_001", "swarm", "stale-swarm")]),
      )

      expect(created.map((input) => input.swarmID)).toEqual(["persisted-swarm", undefined])
    }),
  )

  it.effect("updates stale dispatch context while preserving a reusable goal", () =>
    Effect.gen(function* () {
      created.length = 0
      contexts.length = 0
      listed = [goal("planned", { swarmID: "stale-swarm", directory: "/tmp/stale" })]
      const tool = yield* Tool.init(yield* GraphPlanTool)

      yield* tool.execute(params, context([userMessage("msg_002", "swarm", "current-swarm")]))

      expect(created).toHaveLength(0)
      expect(contexts).toEqual([{ swarmID: "current-swarm", directory }])
    }),
  )
})
