import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Layer, Option, Scope, Context } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Reference } from "@/reference/reference"
import { and, eq } from "drizzle-orm"
import { SessionCommandTable, SessionExecutionTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"
import { Todo } from "./todo"
import { BackgroundJob } from "@/background/job"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Question } from "@/question"
import { OpencodeXClaudeDriver } from "@/opencodex/claude-driver"
import { PromptInput, LoopInput, ShellInput, CommandInput } from "./prompt-schema"
import { STRUCTURED_OUTPUT_SYSTEM_PROMPT, createStructuredOutputTool } from "./prompt-structured-output"
import * as PromptClaim from "./prompt-claim"
import * as PromptShell from "./prompt-shell"
import * as PromptSubtask from "./prompt-subtask"
import * as PromptSwarm from "./prompt-swarm"
import * as PromptUserMessage from "./prompt-user-message"
import { Skill } from "@/skill"
import { argsRegex, bashRegex, placeholderRegex, quoteTrimRegex } from "./prompt-user-message"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

// Re-exported so `SessionPrompt.PromptInput` and friends keep working from
// every existing import path; the definitions live in ./prompt-schema.
export { PromptInput, LoopInput, ShellInput, CommandInput }
export { createStructuredOutputTool }

const elog = EffectLogger.create({ service: "session.prompt" })

function isOrphanedInterruptedTool(part: SessionLegacy.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

const AUTO_CONTINUE_LIMIT = 3
const UNFINISHED_TODO_STATUS = new Set(["pending", "in_progress"])

type UnfinishedWork = {
  todos: Todo.Info[]
  backgroundJobs: BackgroundJob.Info[]
}

function hasVisibleText(message: SessionLegacy.WithParts | undefined) {
  return (
    message?.parts.some(
      (part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
    ) ?? false
  )
}

function hasUnfinishedWork(work: UnfinishedWork) {
  return work.todos.length > 0 || work.backgroundJobs.length > 0
}

function isSessionBackgroundJob(sessionID: SessionID, job: BackgroundJob.Info) {
  if (job.status !== "running") return false
  return job.metadata?.parentSessionId === sessionID || job.metadata?.sessionId === sessionID
}

function autoContinueReason(input: {
  finish: SessionLegacy.Assistant["finish"]
  visibleText: boolean
  unfinished: UnfinishedWork
}) {
  if (!input.finish || input.visibleText) return undefined
  if (["error", "unknown"].includes(input.finish)) return "empty_error" as const
  if (hasUnfinishedWork(input.unfinished) && ["stop", "length"].includes(input.finish))
    return "unfinished_work" as const
  return undefined
}

function autoContinueText(reason: NonNullable<ReturnType<typeof autoContinueReason>>, unfinished: UnfinishedWork) {
  if (reason === "empty_error" && !hasUnfinishedWork(unfinished)) {
    return "<system-reminder>Your previous turn produced no output. Retry the last step or explain what is blocking you.</system-reminder>"
  }
  const detail = [
    unfinished.todos.length > 0 ? `${unfinished.todos.length} todo(s) still pending or in progress` : undefined,
    unfinished.backgroundJobs.length > 0 ? `${unfinished.backgroundJobs.length} background subagent task(s) still running` : undefined,
  ]
    .filter(Boolean)
    .join("; ")
  return [
    "<system-reminder>",
    `Your previous turn ended without a user-visible response while work is still unfinished${detail ? ` (${detail})` : ""}.`,
    "Continue only the unfinished work. Do not repeat a previous final answer.",
    "If there is nothing useful left to do, mark pending or in-progress todos completed or cancelled and give the final response.",
    "</system-reminder>",
  ].join("\n")
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionLegacy.WithParts, Image.Error>
  readonly promptAsync: (input: PromptInput) => Effect.Effect<void, Image.Error>
  readonly recover: () => Effect.Effect<void>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionLegacy.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionLegacy.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionLegacy.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const claudeDriver = yield* OpencodeXClaudeDriver.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const skills = yield* Skill.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const references = yield* Reference.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const background = yield* BackgroundJob.Service
    const todo = yield* Todo.Service
    const { db } = database

    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* rejectPendingInteractions(sessionID)
      yield* state.cancel(sessionID)
    })

    /**
     * A stopped turn can no longer consume an answer, so any card still waiting
     * on the user would be an unanswerable zombie in the dock. Reject them so
     * the UI clears alongside the turn (the Claude driver's asks run on a
     * captured bridge runtime, so fiber interruption alone never reaches them).
     */
    const rejectPendingInteractions = Effect.fn("SessionPrompt.rejectPendingInteractions")(function* (
      sessionID: SessionID,
    ) {
      const permissions = yield* permission.list().pipe(Effect.orElseSucceed(() => []))
      yield* Effect.forEach(
        permissions.filter((request) => request.sessionID === sessionID),
        (request) => permission.reply({ requestID: request.id, reply: "reject" }).pipe(Effect.ignore),
        { discard: true },
      )
      const questions = yield* question.list().pipe(Effect.orElseSucceed(() => []))
      yield* Effect.forEach(
        questions.filter((request) => request.sessionID === sessionID),
        (request) => question.reject(request.id).pipe(Effect.ignore),
        { discard: true },
      )
    })

    const { resolvePromptParts, createUserMessage } = PromptUserMessage.make({
      agents,
      database,
      events,
      fsys,
      image,
      instruction,
      lsp,
      mcp,
      plugin,
      provider,
      references,
      registry,
      sessions,
      currentModel: (sessionID) => currentModel(sessionID),
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionLegacy.WithParts[]
      providerID: ProviderV2.ID
      modelID: ProviderV2.ModelID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionLegacy.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionLegacy.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const { handleSubtask } = PromptSubtask.make({
      agents,
      events,
      permission,
      plugin,
      registry,
      sessions,
      getModel: (providerID, modelID, sessionID) => getModel(providerID, modelID, sessionID),
      ops: () => ops(),
    })

    const { shell } = PromptShell.make({
      agents,
      config,
      events,
      plugin,
      revert,
      sessions,
      spawner,
      state,
      currentModel: (sessionID) => currentModel(sessionID),
      lastAssistant: (sessionID) => lastAssistant(sessionID),
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ProviderV2.ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ProviderV2.ModelID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const acceptPrompt = Effect.fn("SessionPrompt.acceptPrompt")(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: Permission.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      return message
    })

    const prompt: (input: PromptInput) => Effect.Effect<SessionLegacy.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const message = yield* acceptPrompt(input)
      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionLegacy.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown
        let step = 0
        let autoContinues = 0
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionLegacy.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* slog.warn("loop exit with orphaned interrupted tool", {
                messageID: lastAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }

            // Visible final text exits normally; empty turns get a small retry budget.
            const unfinished = {
              todos: (yield* todo.get(sessionID)).filter((item) => UNFINISHED_TODO_STATUS.has(item.status)),
              backgroundJobs: (yield* background.list()).filter((job) => isSessionBackgroundJob(sessionID, job)),
            }
            const reason = autoContinueReason({
              finish: lastAssistant.finish,
              visibleText: hasVisibleText(lastAssistantMsg),
              unfinished,
            })

            if (reason) {
              if (autoContinues >= AUTO_CONTINUE_LIMIT) {
                yield* slog.warn("loop auto-continue limit reached", {
                  messageID: lastAssistant.id,
                  finish: lastAssistant.finish,
                  reason,
                  todos: unfinished.todos.length,
                  backgroundJobs: unfinished.backgroundJobs.length,
                  limit: AUTO_CONTINUE_LIMIT,
                })
              } else {
                autoContinues++
                yield* slog.info("loop auto-continue", {
                  messageID: lastAssistant.id,
                  finish: lastAssistant.finish,
                  reason,
                  attempt: autoContinues,
                  limit: AUTO_CONTINUE_LIMIT,
                  todos: unfinished.todos.length,
                  backgroundJobs: unfinished.backgroundJobs.length,
                })
                const continueMsg: SessionLegacy.User = {
                  id: MessageID.ascending(),
                  sessionID,
                  role: "user",
                  time: { created: Date.now() },
                  agent: lastUser.agent,
                  model: lastUser.model,
                }
                yield* sessions.updateMessage(continueMsg)
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: continueMsg.id,
                  sessionID,
                  type: "text",
                  text: autoContinueText(reason, unfinished),
                  synthetic: true,
                } satisfies SessionLegacy.TextPart)
                continue
              }
            }

            yield* slog.info("exiting loop")
            break
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(AppFileSystem.Service, fsys),
            Effect.provideService(Session.Service, sessions),
            Effect.provideService(Database.Service, database),
          )

          const msg: SessionLegacy.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
            )

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const [skills, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            const system = [...env, ...instructions, ...(skills ? [skills] : [])]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new SessionLegacy.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const { ensureSwarmBriefing, claudeCodeTurn } = PromptSwarm.make({
      claudeDriver,
      database,
      sessions,
      skills,
      prompt: (input) => prompt(input),
    })

    const loop: (input: LoopInput) => Effect.Effect<SessionLegacy.WithParts> = Effect.fn("SessionPrompt.loop")(
      function* (input: LoopInput) {
        // Every prompt entry point funnels through here, so this is the one
        // place that has to know a turn may belong to an external driver.
        yield* ensureSwarmBriefing(input.sessionID).pipe(Effect.ignore)
        const work = (yield* claudeCodeTurn(input.sessionID, input.messageID)) ?? runLoop(input.sessionID)
        return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), work)
      },
    )

    const { launchCommand, recover } = yield* PromptClaim.make({
      database,
      events,
      scope,
      loop: (input) => loop(input),
    })

    const promptAsync = Effect.fn("SessionPrompt.promptAsync")(function* (input: PromptInput) {
      if (input.messageID) {
        const existing = yield* db
          .select({ id: SessionCommandTable.id, status: SessionCommandTable.status })
          .from(SessionCommandTable)
          .where(
            and(
              eq(SessionCommandTable.session_id, input.sessionID),
              eq(SessionCommandTable.message_id, input.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (existing) {
          if (!["succeeded", "failed", "cancelled"].includes(existing.status)) yield* launchCommand(existing.id)
          return
        }
      }
      const message = yield* acceptPrompt(input)
      const ctx = yield* InstanceState.context
      const now = Date.now()
      const commandID = `sec_${Identifier.ascending()}`
      const acceptedCommandID = yield* db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              const inserted = yield* transaction
                .insert(SessionCommandTable)
                .values({
                  id: commandID,
                  session_id: input.sessionID,
                  message_id: message.info.id,
                  project_id: ctx.project.id,
                  directory: ctx.directory,
                  status: input.noReply === true ? "succeeded" : "queued",
                  completed_at: input.noReply === true ? now : null,
                  time_created: now,
                  time_updated: now,
                })
                .onConflictDoNothing()
                .returning({ id: SessionCommandTable.id })
                .get()
              if (!inserted) {
                const existing = yield* transaction
                  .select({ id: SessionCommandTable.id })
                  .from(SessionCommandTable)
                  .where(
                    and(
                      eq(SessionCommandTable.session_id, input.sessionID),
                      eq(SessionCommandTable.message_id, message.info.id),
                    ),
                  )
                  .get()
                if (!existing) return yield* Effect.die(new Error("Prompt command insert did not return a winner"))
                return existing.id
              }
              if (input.noReply === true) return inserted.id
              const current = yield* transaction
                .select()
                .from(SessionExecutionTable)
                .where(eq(SessionExecutionTable.session_id, input.sessionID))
                .get()
              const active =
                current?.state === "running" &&
                !!current.owner_id &&
                !!current.lease_expires_at &&
                current.lease_expires_at > now
              if (active) return inserted.id
              yield* transaction
                .insert(SessionExecutionTable)
                .values({
                  session_id: input.sessionID,
                  project_id: ctx.project.id,
                  directory: ctx.directory,
                  state: "queued",
                  generation: current?.generation ?? 0,
                  queued_at: now,
                  cancel_requested_at: null,
                  time_created: current?.time_created ?? now,
                  time_updated: now,
                })
                .onConflictDoUpdate({
                  target: SessionExecutionTable.session_id,
                  set: {
                    project_id: ctx.project.id,
                    directory: ctx.directory,
                    state: "queued",
                    owner_id: null,
                    lease_expires_at: null,
                    cancel_requested_at: null,
                    queued_at: now,
                    completed_at: null,
                    time_updated: now,
                  },
                })
                .run()
              return inserted.id
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      if (input.noReply !== true) yield* launchCommand(acceptedCommandID)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      promptAsync,
      recover,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(OpencodeXClaudeDriver.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  ).pipe(
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(BackgroundJob.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        Database.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Reference.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
        EventV2Bridge.defaultLayer,
      ),
    ),
  ),
)

export * as SessionPrompt from "./prompt"
