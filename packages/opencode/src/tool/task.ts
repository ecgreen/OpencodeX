import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Cause, Effect, Exit, Schema, Scope } from "effect"
import { asc, eq } from "drizzle-orm"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXSwarmRoleTable } from "@opencode-ai/core/opencodex/sql"
import { SwarmBriefing } from "@/opencodex/swarm-briefing"
import { isSwarmProvider } from "@/provider/swarm-provider"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionLegacy.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "",
  "",
  [
    "Background mode: background=true launches the subagent asynchronously and returns immediately.",
    "Foreground is the default; use it when you need the result before continuing.",
    "Use background only for independent work that can run while you continue elsewhere.",
    "You will be notified automatically when it finishes.",
  ].join(" "),
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  model: Schema.optional(Schema.String).annotate({
    description:
      'Optional model override in "providerID/modelID" form. Only use when explicitly instructed to run this task on a specific model (e.g. by a swarm briefing); omit to use the agent default.',
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  swarm_role: Schema.optional(Schema.String).annotate({
    description:
      "For swarm sessions only: the swarm role this delegation runs as, exactly as listed in the briefing. Repeat the same role across parallel calls to run several copies of it.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the agent in the background. You will be notified when it completes.",
  }),
})

function output(sessionID: SessionID, text: string) {
  return [`<task id="${sessionID}" state="completed">`, "<task_result>", text, "</task_result>", "</task>"].join("\n")
}

function backgroundOutput(sessionID: SessionID) {
  return [
    `<task id="${sessionID}" state="running">`,
    "<summary>Background task started</summary>",
    "<task_result>",
    "Background task started. You will be notified automatically when it finishes; do not poll for progress.",
    "Do not duplicate its work. Continue only with non-overlapping work, or stop if there is nothing else useful to do.",
    "</task_result>",
    "</task>",
  ].join("\n")
}

function backgroundMessage(input: {
  sessionID: SessionID
  description: string
  state: "completed" | "error"
  text: string
}) {
  const tag = input.state === "completed" ? "task_result" : "task_error"
  const title =
    input.state === "completed"
      ? `Background task completed: ${input.description}`
      : `Background task failed: ${input.description}`
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    `<summary>${title}</summary>`,
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * How many delegation hops a swarm may nest.
 *
 * Real graph engineering is layered: an orchestrator fans work out, a builder
 * hands its output to a reviewer, the reviewer hands corrections back down. One
 * hop would make every swarm a star with the orchestrator at the centre. The
 * cap exists only so a role that delegates to itself cannot recurse forever -
 * the orchestrator is depth 0, so this allows four layers of specialists below.
 */
export const MAX_SWARM_DELEGATION_DEPTH = 4

/**
 * The swarm a session belongs to, and how deep in the delegation chain it sits.
 *
 * The orchestrator is recognised by its model routing to the swarm facade;
 * every session below it carries the swarm on its own metadata, which is what
 * lets membership survive past the first hop.
 */
export function swarmContext(session: {
  model?: { providerID: string; id: string } | null
  metadata?: Record<string, unknown> | null
}): { swarmID: string; depth: number } | undefined {
  if (session.model?.providerID === "swarm" && session.model.id) return { swarmID: session.model.id, depth: 0 }
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null) return undefined
  const { swarmID, swarmDepth } = opencodex as { swarmID?: unknown; swarmDepth?: unknown }
  if (typeof swarmID !== "string" || !swarmID) return undefined
  return { swarmID, depth: typeof swarmDepth === "number" && swarmDepth > 0 ? swarmDepth : 1 }
}

/** A resolved swarm role's configured model, when it has a complete one. */
function swarmRoleModel(role: { provider_id: string | null; model_id: string | null } | undefined) {
  if (!role?.provider_id || !role.model_id) return undefined
  return { providerID: ProviderV2.ID.make(role.provider_id), modelID: ProviderV2.ModelID.make(role.model_id) }
}

/**
 * Parses a "providerID/modelID" override. Malformed values fall back to the
 * agent default rather than failing the delegation; a wrong-but-well-formed
 * route surfaces downstream as a normal model-not-found error.
 */
function parseModelOverride(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const index = trimmed.indexOf("/")
  if (index <= 0 || index === trimmed.length - 1) return undefined
  return {
    providerID: ProviderV2.ID.make(trimmed.slice(0, index)),
    modelID: ProviderV2.ModelID.make(trimmed.slice(index + 1)),
  }
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    /**
     * The swarm role a delegation runs as, resolved against the swarm's own
     * roster. The explicit swarm_role parameter wins; older orchestrators that
     * lead the description with the role name still match through the prefix.
     * No match is not an error - the child stays a plain swarm subtask.
     */
    const swarmRoleRows = Effect.fn("TaskTool.swarmRoleRows")(function* (swarmID: string) {
      return yield* database.db
        .select({
          name: OpencodeXSwarmRoleTable.name,
          provider_id: OpencodeXSwarmRoleTable.provider_id,
          model_id: OpencodeXSwarmRoleTable.model_id,
        })
        .from(OpencodeXSwarmRoleTable)
        .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
        .orderBy(asc(OpencodeXSwarmRoleTable.sort_order))
        .all()
        .pipe(Effect.orElseSucceed(() => []))
    })

    const resolveSwarmRole = Effect.fn("TaskTool.resolveSwarmRole")(function* (
      swarmID: string,
      params: Schema.Schema.Type<typeof Parameters>,
    ) {
      const roles = yield* swarmRoleRows(swarmID)
      const requested = params.swarm_role?.trim() || params.description.split(":")[0]
      return SwarmBriefing.matchSwarmRole(roles, requested ?? "")
    })

    /** The concrete model the swarm facade stands for: its orchestrator's. */
    const orchestratorModel = Effect.fn("TaskTool.orchestratorModel")(function* (swarmID: string) {
      return swarmRoleModel((yield* swarmRoleRows(swarmID))[0])
    })

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const swarm = swarmContext(parent)
      // The child's own depth. Everything below keys off this rather than off
      // "is my parent the orchestrator", so a specialist handing work to the
      // next layer keeps its team, its roles, and its place in the graph.
      const childDepth = swarm ? swarm.depth + 1 : 0
      const swarmRole = swarm ? yield* resolveSwarmRole(swarm.swarmID, params) : undefined
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          // A swarm session's subtasks are its team at work; tagging them lets
          // the GUI group each child under the swarm's team view. The role is
          // resolved here rather than trusted from the model, so the same role
          // delegated four times lands in the same bucket every time. The depth
          // rides along so a hand-off two layers down is still recognisably
          // part of this swarm.
          ...(swarm
            ? {
                metadata: {
                  opencodex: {
                    swarmID: swarm.swarmID,
                    swarmDepth: childDepth,
                    ...(swarmRole ? { swarmRole: swarmRole.name } : {}),
                  },
                },
              }
            : {}),
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const caller = { providerID: msg.info.providerID, modelID: msg.info.modelID }
      // Explicit override first (a swarm briefing pins each role's model), then
      // the resolved swarm role's own model. Inside a swarm the caller's own
      // model comes next: a role spawning helpers of itself should run them on
      // what it is running, not on whatever its agent happens to configure.
      // Outside a swarm the agent's model keeps priority, as it always has.
      const requested = parseModelOverride(params.model) ??
        swarmRoleModel(swarmRole) ??
        (swarm && !isSwarmProvider(caller.providerID) ? caller : undefined) ??
        next.model ??
        caller
      // A subagent never runs on the swarm facade. Routing it there would make
      // the child a swarm session of its own - its first turn would be handed a
      // briefing and a team, and it would start delegating instead of doing the
      // work it was asked for, recursively. It reaches this point whenever the
      // role could not be resolved and the caller's own model *is* the facade
      // (the orchestrator delegating), so the fallback is the concrete model
      // that facade stands for.
      const model = isSwarmProvider(requested.providerID)
        ? (yield* orchestratorModel(requested.modelID)) ?? next.model
        : requested
      if (!model || isSwarmProvider(model.providerID))
        return yield* Effect.fail(
          new Error(
            `Cannot delegate: swarm ${requested.modelID} resolves to no concrete model. ` +
              `Give its orchestrator role a model, or pass one on the task call.`,
          ),
        )
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: next.name,
          tools: {
            ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
            // A swarm role must be able to fan its own work out and to hand it
            // to the next layer, so a swarm member keeps the task tool even
            // when its agent does not grant it explicitly - up to the depth cap,
            // past which delegation stops rather than recursing forever.
            ...(( swarm && childDepth < MAX_SWARM_DELEGATION_DEPTH) ||
            next.permission.some((rule) => rule.permission === id)
              ? {}
              : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
        })
        // The report is the last real text part. Synthetic parts are injected
        // briefings, and a silent "" for a failed subagent reads as success to
        // the caller - that is exactly the "completed but empty" confusion.
        const report =
          result.parts
            .flatMap((part) => (part.type === "text" && !part.synthetic && part.text.trim() ? [part.text.trim()] : []))
            .at(-1) ?? ""
        if (result.info.role === "assistant" && result.info.error)
          return [`The subagent failed: ${JSON.stringify(result.info.error)}`, report].filter(Boolean).join("\n")
        return report || "The subagent completed without producing a text report."
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: backgroundMessage({
                  sessionID: nextSession.id,
                  description: params.description,
                  state,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const existing = yield* background.get(nextSession.id)
      if (existing?.status === "running") {
        return yield* Effect.fail(new Error(`Task ${nextSession.id} is already running.`))
      }

      if (runInBackground) {
        const info = yield* background.start({
          id: nextSession.id,
          type: id,
          title: params.description,
          metadata,
          run: runTask().pipe(
            Effect.tap((text) => inject("completed", text).pipe(Effect.ignore)),
            Effect.catchCause((cause) =>
              (Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : inject("error", errorText(Cause.squash(cause))).pipe(Effect.ignore)
              ).pipe(Effect.andThen(Effect.failCause(cause))),
            ),
          ),
        })

        return {
          title: params.description,
          metadata: {
            ...metadata,
            jobId: info.id,
          },
          output: backgroundOutput(nextSession.id),
        }
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const text = yield* runTask()
            return {
              title: params.description,
              metadata,
              output: output(nextSession.id, text),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents ? DESCRIPTION + BACKGROUND_DESCRIPTION : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
