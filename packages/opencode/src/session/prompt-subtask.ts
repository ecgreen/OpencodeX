import { ulid } from "ulid"
import { Cause, Context, Effect } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "../agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { ToolRegistry } from "@/tool/registry"
import { MessageID, PartID, SessionID } from "./schema"
import * as Session from "./session"

const log = Log.create({ service: "session.prompt" })

export interface Deps {
  readonly agents: Context.Service.Shape<typeof Agent.Service>
  readonly events: Context.Service.Shape<typeof EventV2Bridge.Service>
  readonly permission: Context.Service.Shape<typeof Permission.Service>
  readonly plugin: Context.Service.Shape<typeof Plugin.Service>
  readonly registry: Context.Service.Shape<typeof ToolRegistry.Service>
  readonly sessions: Context.Service.Shape<typeof Session.Service>
  readonly getModel: (
    providerID: ProviderV2.ID,
    modelID: ProviderV2.ModelID,
    sessionID: SessionID,
  ) => Effect.Effect<Provider.Model>
  readonly ops: () => Effect.Effect<TaskPromptOps>
}

/**
 * A `subtask` part in the user message means the turn is a delegated agent run
 * rather than a model call: this drives the task tool directly and writes the
 * assistant message/tool part that represents it.
 */
export function make(deps: Deps) {
  const { agents, events, permission, plugin, registry, sessions, getModel, ops } = deps

  const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
    task: SessionLegacy.SubtaskPart
    model: Provider.Model
    lastUser: SessionLegacy.User
    sessionID: SessionID
    session: Session.Info
    msgs: SessionLegacy.WithParts[]
  }) {
    const { task, model, lastUser, sessionID, session, msgs } = input
    const ctx = yield* InstanceState.context
    const promptOps = yield* ops()
    const { task: taskTool } = yield* registry.named()
    const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
    const assistantMessage: SessionLegacy.Assistant = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      parentID: lastUser.id,
      sessionID,
      mode: task.agent,
      agent: task.agent,
      variant: lastUser.model.variant,
      path: { cwd: ctx.directory, root: ctx.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: taskModel.id,
      providerID: taskModel.providerID,
      time: { created: Date.now() },
    })
    let part: SessionLegacy.ToolPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: assistantMessage.id,
      sessionID: assistantMessage.sessionID,
      type: "tool",
      callID: ulid(),
      tool: TaskTool.id,
      state: {
        status: "running",
        input: {
          prompt: task.prompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
        },
        time: { start: Date.now() },
      },
    })
    const taskArgs = {
      prompt: task.prompt,
      description: task.description,
      subagent_type: task.agent,
      command: task.command,
    }
    yield* plugin.trigger("tool.execute.before", { tool: TaskTool.id, sessionID, callID: part.id }, { args: taskArgs })

    const taskAgent = yield* agents.get(task.agent)
    if (!taskAgent) {
      const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
      yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
      throw error
    }

    let error: Error | undefined
    const taskAbort = new AbortController()
    const result = yield* taskTool
      .execute(taskArgs, {
        agent: task.agent,
        messageID: assistantMessage.id,
        sessionID,
        directory: session.directory,
        workspaceID: session.workspaceID,
        abort: taskAbort.signal,
        callID: part.callID,
        extra: { bypassAgentCheck: true, promptOps },
        messages: msgs,
        // Subtask progress is in-flight state, so it is broadcast without a
        // journal append. `part` stays the in-memory source of truth for the
        // durable completion/error write below, which is unaffected.
        metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
          Effect.gen(function* () {
            part = yield* sessions.updatePart(
              {
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionLegacy.ToolPart,
              { transient: true },
            )
          }),
        ask: (req: any) =>
          permission
            .ask({
              ...req,
              sessionID,
              ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
            })
            .pipe(Effect.orDie),
      })
      .pipe(
        Effect.catchCause((cause) => {
          const defect = Cause.squash(cause)
          error = defect instanceof Error ? defect : new Error(String(defect))
          log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
          return Effect.void
        }),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            taskAbort.abort()
            assistantMessage.finish = "tool-calls"
            assistantMessage.time.completed = Date.now()
            yield* sessions.updateMessage(assistantMessage)
            if (part.state.status === "running") {
              yield* sessions.updatePart({
                ...part,
                state: {
                  status: "error",
                  error: "Cancelled",
                  time: { start: part.state.time.start, end: Date.now() },
                  metadata: part.state.metadata,
                  input: part.state.input,
                },
              } satisfies SessionLegacy.ToolPart)
            }
          }),
        ),
      )

    const attachments = result?.attachments?.map((attachment) => ({
      ...attachment,
      id: PartID.ascending(),
      sessionID,
      messageID: assistantMessage.id,
    }))

    yield* plugin.trigger(
      "tool.execute.after",
      { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
      result,
    )

    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    yield* sessions.updateMessage(assistantMessage)

    if (result && part.state.status === "running") {
      yield* sessions.updatePart({
        ...part,
        state: {
          status: "completed",
          input: part.state.input,
          title: result.title,
          metadata: result.metadata,
          output: result.output,
          attachments,
          time: { ...part.state.time, end: Date.now() },
        },
      } satisfies SessionLegacy.ToolPart)
      // The durable tool part above is the parent's copy of the child's
      // report: for a delegation that is what "delivered" means, so the
      // child's run record is marked only now, compare-and-set on its runID.
      const childSessionID = result.metadata?.sessionId
      const delegationRunID = result.metadata?.runID
      if (typeof childSessionID === "string" && typeof delegationRunID === "string") {
        yield* sessions
          .stampDelegationDelivery({
            sessionID: SessionID.make(childSessionID),
            runID: delegationRunID,
            outcome: "delivered",
          })
          .pipe(Effect.ignore)
      }
    }

    if (!result) {
      yield* sessions.updatePart({
        ...part,
        state: {
          status: "error",
          error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
          time: {
            start: part.state.status === "running" ? part.state.time.start : Date.now(),
            end: Date.now(),
          },
          metadata: part.state.status === "pending" ? undefined : part.state.metadata,
          input: part.state.input,
        },
      } satisfies SessionLegacy.ToolPart)
    }

    if (!task.command) return

    const summaryUserMsg: SessionLegacy.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: lastUser.agent,
      model: lastUser.model,
    }
    yield* sessions.updateMessage(summaryUserMsg)
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: summaryUserMsg.id,
      sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies SessionLegacy.TextPart)
  })

  return { handleSubtask }
}
