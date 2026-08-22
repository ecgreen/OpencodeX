import { afterEach, describe, expect } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { MAX_SWARM_DELEGATION_DEPTH, TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { delegationOutcome, delegationRecord } from "../../src/session/delegation-outcome"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { OpencodeXProjectTable, OpencodeXSwarmRoleTable, OpencodeXSwarmTable } from "@opencode-ai/core/opencodex/sql"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ProviderV2.ModelID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    RuntimeFlags.layer(flags),
  )

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (
  title = "Pinned",
  options?: {
    model?: { id: ProviderV2.ModelID; providerID: ProviderV2.ID }
    /** The model the seeded assistant turn ran on, when it matters. */
    assistantModel?: { providerID: ProviderV2.ID; modelID: ProviderV2.ModelID }
    metadata?: Record<string, unknown>
  },
) {
  const session = yield* Session.Service
  const chat = yield* session.create({
    title,
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
  })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionLegacy.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    // Opt-in, because an orchestrator's turn records the swarm facade it was
    // asked for - the value the delegation fallback would hand to its children.
    modelID: options?.assistantModel?.modelID ?? ref.modelID,
    providerID: options?.assistantModel?.providerID ?? ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
    loop: () => Effect.die("unexpected task loop"),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionLegacy.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function failedReply(input: SessionPrompt.PromptInput, code: string): SessionLegacy.WithParts {
  const failed = reply(input, "")
  return {
    ...failed,
    info: {
      ...failed.info,
      error: new SessionLegacy.APIError({
        message: "request failed",
        responseBody: JSON.stringify({ error: { code } }),
        isRetryable: false,
      }),
    },
    parts: [],
  } as unknown as SessionLegacy.WithParts
}

function persistPromptResult(
  sessions: Pick<Session.Interface, "updateMessage" | "updatePart">,
  input: SessionPrompt.PromptInput,
  result: SessionLegacy.WithParts,
) {
  return Effect.gen(function* () {
    const user: SessionLegacy.User = {
      id: input.messageID!,
      role: "user",
      sessionID: input.sessionID,
      agent: input.agent ?? "general",
      model: {
        providerID: input.model!.providerID,
        modelID: input.model!.modelID,
        ...(input.variant ? { variant: input.variant } : {}),
      },
      time: { created: Date.now() },
    }
    yield* sessions.updateMessage(user)
    yield* Effect.forEach(
      input.parts.filter((part): part is SessionLegacy.TextPartInput => part.type === "text"),
      (part) => sessions.updatePart({
        ...part,
        id: PartID.ascending(),
        messageID: user.id,
        sessionID: user.sessionID,
      }),
      { discard: true },
    )
    return yield* persistAssistantResult(sessions, result)
  })
}

function persistAssistantResult(
  sessions: Pick<Session.Interface, "updateMessage" | "updatePart">,
  result: SessionLegacy.WithParts,
) {
  return sessions.updateMessage(result.info).pipe(
    Effect.andThen(Effect.forEach(result.parts, (part) => sessions.updatePart(part), { discard: true })),
    Effect.as(result),
  )
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
        loop: () => Effect.die("unexpected task loop"),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute cancels child session when abort signal already fired", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const cancelled = defer<SessionID>()
      let prompted = false
      const abort = new AbortController()
      abort.abort()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.sync(() => {
            prompted = true
            return reply(input, "unexpected")
          }),
        loop: () => Effect.die("unexpected task loop"),
      }

      const fiber = yield* def
        .execute(
          { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      expect(yield* Effect.promise(() => cancelled.promise)).toBeString()
      expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
      expect(prompted).toBe(false)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "read",
            pattern: "*",
            action: "allow",
          },
        ])
        expect(seen?.tools).toEqual({
          todowrite: false,
          bash: false,
          read: false,
        })
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("keeps the task tool for a swarm session's specialists and tags them", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const swarm = yield* seed("Swarm chat", {
        model: { id: ProviderV2.ModelID.make("swarm-1"), providerID: ProviderV2.ID.make("swarm") },
      })
      const plain = yield* seed("Plain chat")
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const tools: Record<string, SessionPrompt.PromptInput["tools"]> = {}
      const exec = (chat: typeof swarm, key: string) =>
        def.execute(
          {
            description: "Senior Engineer: build the graph",
            prompt: "fan the work out as needed",
            subagent_type: "general",
          },
          {
            sessionID: chat.chat.id,
            messageID: chat.assistant.id,
            directory: chat.chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps({ onPrompt: (input) => (tools[key] = input.tools) }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

      const result = yield* exec(swarm, "swarm")
      yield* exec(plain, "plain")

      // A specialist keeps its own task tool so a role can spawn subagents of
      // itself; an ordinary subagent still loses it unless its agent grants it.
      expect(tools.swarm?.task).toBeUndefined()
      expect(tools.plain?.task).toBe(false)

      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.parentID).toBe(swarm.chat.id)
      // The depth rides along so membership survives past the first hop, and
      // the finished run stamps its durable outcome beside it.
      expect(child.metadata?.opencodex).toMatchObject({ swarmID: "swarm-1", swarmDepth: 1 })
      expect(delegationOutcome(child.metadata)).toBe("completed")
    }),
  )

  it.instance("carries the swarm down a multi-layer delegation, stopping at the cap", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const tools: Record<string, SessionPrompt.PromptInput["tools"]> = {}
      // A specialist two layers down is still a member of its swarm, so it can
      // hand work to the next layer: builder -> reviewer -> builder.
      const middle = yield* seed("Specialist", { metadata: { opencodex: { swarmID: "swarm-1", swarmDepth: 2 } } })
      const delegateFrom = (chat: typeof middle, key: string) =>
        def.execute(
          { description: "Reviewer: check the work", prompt: "hand off to the next layer", subagent_type: "general" },
          {
            sessionID: chat.chat.id,
            messageID: chat.assistant.id,
            directory: chat.chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps({ onPrompt: (input) => (tools[key] = input.tools) }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

      const handoff = yield* delegateFrom(middle, "middle")
      expect(tools.middle?.task).toBeUndefined()
      const grandchild = yield* sessions.get(handoff.metadata.sessionId)
      expect(grandchild.metadata?.opencodex).toMatchObject({ swarmID: "swarm-1", swarmDepth: 3 })
      expect(delegationOutcome(grandchild.metadata)).toBe("completed")

      // At the cap the chain stops rather than recursing forever.
      const deepest = yield* seed("Deep specialist", {
        metadata: { opencodex: { swarmID: "swarm-1", swarmDepth: MAX_SWARM_DELEGATION_DEPTH - 1 } },
      })
      yield* delegateFrom(deepest, "deepest")
      expect(tools.deepest?.task).toBe(false)
    }),
  )

  it.instance("resolves the swarm role, tags the child with it, and uses the role's model", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      // The role lookup joins through real rows: project -> swarm -> roles.
      yield* database.db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.make("prj_task_test"), worktree: "/tmp", sandboxes: [] })
      yield* database.db.insert(OpencodeXProjectTable).values({ id: "opx_task_test", project_id: ProjectV2.ID.make("prj_task_test") })
      yield* database.db.insert(OpencodeXSwarmTable).values({
        id: "swm_task_test",
        opencodex_project_id: "opx_task_test",
        title: "Feature Team",
        prompt: "Ship it",
        status: "running",
        source: "manual",
      })
      yield* database.db.insert(OpencodeXSwarmRoleTable).values([
        { id: "role_orch", swarm_id: "swm_task_test", name: "Orchestrator", status: "running", instructions: "", sort_order: 0 },
        {
          id: "role_eng",
          swarm_id: "swm_task_test",
          name: "Senior Engineer",
          status: "running",
          instructions: "",
          sort_order: 1,
          provider_id: "anthropic",
          model_id: "claude-fable-5",
          fallback_models: JSON.stringify([
            { providerID: "openai", modelID: "gpt-5" },
            { providerID: "google", modelID: "gemini-3" },
          ]),
        },
      ])
      const { chat, assistant } = yield* seed("Swarm chat", {
        model: { id: ProviderV2.ModelID.make("swm_task_test"), providerID: ProviderV2.ID.make("swarm") },
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const prompts: SessionPrompt.PromptInput[] = []
      const promptOps = stubOps({ onPrompt: (input) => prompts.push(input) })
      const exec = (input: { description: string; swarm_role?: string }) =>
        def.execute(
          { ...input, prompt: "do the work", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

      // The explicit parameter wins even when the description says nothing
      // useful, and running the same role twice makes a second tagged copy.
      const first = yield* exec({ description: "build module A", swarm_role: "senior engineer" })
      const second = yield* exec({ description: "build module B", swarm_role: "Senior Engineer" })
      // Older orchestrators that only lead the description with the role name
      // still resolve through the prefix fallback.
      const third = yield* exec({ description: "Senior Engineer: build module C" })

      for (const result of [first, second, third]) {
        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.metadata?.opencodex).toMatchObject({
          swarmID: "swm_task_test",
          swarmDepth: 1,
          swarmRole: "Senior Engineer",
        })
        expect(delegationOutcome(child.metadata)).toBe("completed")
      }
      expect(new Set([first, second, third].map((result) => result.metadata.sessionId)).size).toBe(3)
      // No explicit model was passed, so the role's configured model routes it.
      expect(prompts.map((input) => `${input.model?.providerID}/${input.model?.modelID}`)).toEqual([
        "anthropic/claude-fable-5",
        "anthropic/claude-fable-5",
        "anthropic/claude-fable-5",
      ])

      const attempts: SessionPrompt.PromptInput[] = []
      const fallbackResult = yield* def.execute(
        {
          description: "build module D",
          prompt: "do the work",
          subagent_type: "general",
          swarm_role: "Senior Engineer",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: (input: SessionPrompt.PromptInput) =>
                Effect.gen(function* () {
                  attempts.push(input)
                  return yield* persistPromptResult(sessions, input, failedReply(input, "insufficient_quota"))
                }),
              loop: (input: SessionPrompt.LoopInput) =>
                Effect.gen(function* () {
                  const turn = yield* sessions.messageWithChildren({ sessionID: input.sessionID, messageID: input.messageID! })
                  const user = turn.find((message): message is SessionLegacy.WithParts & { info: SessionLegacy.User } => message.info.role === "user")!
                  const nextInput = {
                    sessionID: input.sessionID,
                    messageID: user.info.id,
                    model: user.info.model,
                    agent: user.info.agent,
                    parts: [],
                  } satisfies SessionPrompt.PromptInput
                  attempts.push(nextInput)
                  return yield* persistAssistantResult(sessions, reply(nextInput, "fallback done"))
                }),
            },
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(attempts.map((input) => `${input.model?.providerID}/${input.model?.modelID}`)).toEqual([
        "anthropic/claude-fable-5",
        "openai/gpt-5",
      ])
      expect(fallbackResult.output).toContain("fallback done")
      expect(fallbackResult.metadata.model).toMatchObject({ providerID: "openai", modelID: "gpt-5" })
      expect((yield* sessions.messages({ sessionID: fallbackResult.metadata.sessionId })).filter((message) => message.info.role === "user")).toHaveLength(1)

      let blockedLoops = 0
      const blocked = yield* def.execute(
        { description: "build module safety", prompt: "do the work", subagent_type: "general", swarm_role: "Senior Engineer" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: (input: SessionPrompt.PromptInput) =>
                Effect.gen(function* () {
                  yield* persistPromptResult(sessions, input, reply(input, "visible work from an earlier step"))
                  return yield* persistAssistantResult(sessions, failedReply(input, "quota_exceeded"))
                }),
              loop: () => {
                blockedLoops++
                return Effect.die("fallback must remain blocked")
              },
            },
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(blocked.output).toContain("failed")
      expect(blockedLoops).toBe(0)
      expect((yield* sessions.messages({ sessionID: blocked.metadata.sessionId })).filter((message) => message.info.role === "user")).toHaveLength(1)

      const overrides: SessionPrompt.PromptInput[] = []
      yield* def.execute(
        {
          description: "build module E",
          prompt: "do the work",
          subagent_type: "general",
          swarm_role: "Senior Engineer",
          model: "other/custom",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: (input: SessionPrompt.PromptInput) => {
                overrides.push(input)
                const failed = reply(input, "")
                return Effect.succeed({
                  ...failed,
                  info: {
                    ...failed.info,
                    error: new SessionLegacy.APIError({ message: "quota exceeded", isRetryable: false }),
                  },
                  parts: [],
                })
              },
            },
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(overrides).toHaveLength(1)
      expect(overrides[0]?.model).toMatchObject({ providerID: "other", modelID: "custom" })
    }),
  )

  it.instance("never routes a subagent to the swarm facade", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.make("prj_facade"), worktree: "/tmp", sandboxes: [] })
      yield* database.db
        .insert(OpencodeXProjectTable)
        .values({ id: "opx_facade", project_id: ProjectV2.ID.make("prj_facade") })
      yield* database.db.insert(OpencodeXSwarmTable).values({
        id: "swm_facade",
        opencodex_project_id: "opx_facade",
        title: "Facade Team",
        prompt: "Ship it",
        status: "running",
        source: "manual",
      })
      yield* database.db.insert(OpencodeXSwarmRoleTable).values([
        {
          id: "role_facade_orch",
          swarm_id: "swm_facade",
          name: "Orchestrator",
          status: "running",
          instructions: "",
          sort_order: 0,
          provider_id: "anthropic",
          model_id: "claude-opus-5",
        },
      ])
      const { chat, assistant } = yield* seed("Facade chat", {
        model: { id: ProviderV2.ModelID.make("swm_facade"), providerID: ProviderV2.ID.make("swarm") },
        assistantModel: {
          providerID: ProviderV2.ID.make("swarm"),
          modelID: ProviderV2.ModelID.make("swm_facade"),
        },
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const prompts: SessionPrompt.PromptInput[] = []
      // No role matches, so resolution falls all the way back to the caller's
      // own model - which for an orchestrator is the swarm facade itself.
      // Routing the child there would make it a swarm that delegates instead of
      // working, recursively.
      const result = yield* def.execute(
        { description: "just do this", prompt: "do the work", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ onPrompt: (input) => prompts.push(input) }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(prompts[0]?.model).toMatchObject({ providerID: "anthropic", modelID: "claude-opus-5" })
      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.model?.providerID).not.toBe("swarm")
    }),
  )

  it.instance("runs a role's own helpers on the model that role is running", () =>
    Effect.gen(function* () {
      // A specialist spawning subagents of itself has no role to resolve, so it
      // must not fall through to the subagent agent's configured model - the
      // helper runs on what its parent is running.
      const specialist = yield* seed("Designer", {
        metadata: { opencodex: { swarmID: "swm_helpers", swarmDepth: 1 } },
        assistantModel: { providerID: ProviderV2.ID.make("openai"), modelID: ProviderV2.ModelID.make("gpt-5.2") },
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const prompts: SessionPrompt.PromptInput[] = []
      yield* def.execute(
        { description: "explore the icon set", prompt: "look around", subagent_type: "general" },
        {
          sessionID: specialist.chat.id,
          messageID: specialist.assistant.id,
          directory: specialist.chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ onPrompt: (input) => prompts.push(input) }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(prompts[0]?.model).toMatchObject({ providerID: "openai", modelID: "gpt-5.2" })
    }),
  )

  it.instance("surfaces a subagent failure instead of returning silence", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            const base = reply(input, "")
            return {
              info: {
                ...base.info,
                error: {
                  name: "ProviderAuthError",
                  data: { providerID: "test", message: "credentials expired" },
                } as SessionLegacy.Assistant["error"],
              },
              parts: [],
            }
          }),
      }

      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into it", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("The subagent failed:")
      expect(result.output).toContain("credentials expired")
    }),
  )

  it.instance("labels an empty report instead of returning an empty string", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        // Only a synthetic part: an injected briefing, not a report.
        prompt: (input) =>
          Effect.sync(() => {
            const base = reply(input, "internal briefing")
            return { info: base.info, parts: [{ ...base.parts[0], synthetic: true }] }
          }),
      }

      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into it", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("The subagent completed without producing a text report.")
      expect(result.output).not.toContain("internal briefing")
    }),
  )

  it.instance("rejects background execution when the experiment is disabled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("execute stamps the child with a succeeded delegation outcome", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        { description: "do work", prompt: "do it", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const child = yield* sessions.get(SessionID.make(result.metadata.sessionId))
      const record = delegationRecord(child.metadata)
      expect(record).toMatchObject({
        phase: "settled",
        outcome: "completed",
        attempt: 1,
        parentSessionID: chat.id,
        parentMessageID: assistant.id,
        // Execution settled; the parent has not durably received the report
        // yet - that mark belongs to the tool-part persistence, not the tool.
        deliveryOutcome: "pending",
      })
      expect(result.metadata.runID).toBe(record!.runID)
    }),
  )

  it.instance("execute stamps the child with a failed delegation outcome on subagent error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      // The subagent's turn completes, but the assistant message carries an
      // error - the "finished badly" shape a durable record must not miss.
      const failingOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            const message = reply(input, "partial output")
            return {
              ...message,
              info: { ...message.info, error: { name: "UnknownError", data: { message: "boom" } } },
            } as SessionLegacy.WithParts
          }),
      }

      const result = yield* def.execute(
        { description: "do work", prompt: "do it", subagent_type: "general" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: failingOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const child = yield* sessions.get(SessionID.make(result.metadata.sessionId))
      expect(delegationOutcome(child.metadata)).toBe("errored")
      // The stamp must ride alongside the swarm bookkeeping, never replace it.
      expect(result.output).toContain("failed")
    }),
  )

  it.instance("a reused task session renumbers the run and replaces the prior record", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const sessions = yield* Session.Service
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const exec = (task_id?: string) =>
        def.execute(
          { description: "do work", prompt: "do it", subagent_type: "general", ...(task_id ? { task_id } : {}) },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps({ text: "done" }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

      const first = yield* exec()
      const firstRecord = delegationRecord(
        (yield* sessions.get(SessionID.make(first.metadata.sessionId))).metadata,
      )
      const second = yield* exec(first.metadata.sessionId)
      const secondRecord = delegationRecord(
        (yield* sessions.get(SessionID.make(second.metadata.sessionId))).metadata,
      )

      expect(second.metadata.sessionId).toBe(first.metadata.sessionId)
      expect(firstRecord).toMatchObject({ attempt: 1, phase: "settled", outcome: "completed" })
      expect(secondRecord).toMatchObject({ attempt: 2, phase: "settled", outcome: "completed" })
      expect(secondRecord!.runID).not.toBe(firstRecord!.runID)
    }),
  )

  it.instance("a foreground abort stamps the child cancelled even when the prompt returns cleanly", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      // The prompt resolves with a normal reply *after* cancellation was
      // requested - the late clean return the cancellation contract covers.
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "finished anyway"))),
        loop: () => Effect.die("unexpected task loop"),
      }

      const fiber = yield* def
        .execute(
          { description: "inspect bug", prompt: "look into it", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      // The observed cancellation request wins over the late clean return.
      const child = yield* sessions.get(input.sessionID)
      expect(delegationRecord(child.metadata)).toMatchObject({ phase: "settled", outcome: "cancelled" })
    }),
  )

  it.instance("a defect during the child prompt still settles the record as errored", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let childID: SessionID | undefined
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          childID = input.sessionID
          return Effect.die(new Error("boom"))
        },
      }

      const exit = yield* def
        .execute(
          { description: "inspect bug", prompt: "look into it", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            directory: chat.directory,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isSuccess(exit)).toBe(false)
      const child = yield* sessions.get(childID!)
      expect(delegationRecord(child.metadata)).toMatchObject({ phase: "settled", outcome: "errored" })
    }),
  )

  background.instance("a background subagent error fails the job and stamps the child errored", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const notifications: string[] = []
      // The child's turn returns an assistant-level error; the parent's
      // notification prompt succeeds so the wording can be observed.
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            if (input.sessionID === chat.id) {
              for (const part of input.parts) if (part.type === "text") notifications.push(part.text)
              return reply(input, "noted")
            }
            const base = reply(input, "partial output")
            return {
              ...base,
              info: { ...base.info, error: { name: "UnknownError", data: { message: "boom" } } },
            } as SessionLegacy.WithParts
          }),
      }

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into it",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      // The job, the child's stamp, and the notification tell the same story.
      expect(waited.info?.status).toBe("error")
      const child = yield* sessions.get(SessionID.make(result.metadata.sessionId))
      expect(delegationOutcome(child.metadata)).toBe("errored")
      const settled = yield* Effect.promise(async () => {
        for (let i = 0; i < 50 && notifications.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
        return notifications
      })
      expect(settled[0]).toContain('state="error"')
      expect(settled[0]).toContain("Background task failed")
    }),
  )

  background.instance("a delivered background notification marks the run delivered", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into it",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          directory: chat.directory,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      // The notification prompt is forked; poll briefly for its delivery mark.
      const record = yield* Effect.promise(async () => {
        for (let i = 0; i < 50; i++) {
          const child = await Effect.runPromise(
            sessions.get(SessionID.make(result.metadata.sessionId)).pipe(Effect.orDie),
          )
          const current = delegationRecord(child.metadata)
          if (current?.deliveryOutcome === "delivered") return current
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return undefined
      })
      expect(record).toMatchObject({ outcome: "completed", deliveryOutcome: "delivered" })
    }),
  )
})
