import { ulid } from "ulid"
import { Cause, Context, Effect, Exit, Latch } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as Stream from "effect/Stream"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { NamedError } from "@opencode-ai/core/util/error"
import { Agent } from "../agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "../plugin"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { MessageID, PartID, SessionID } from "./schema"
import type { CurrentModel } from "./prompt-user-message"
import type { ShellInput } from "./prompt-schema"
import { SessionRevert } from "./revert"
import { SessionRunState } from "./run-state"
import * as Session from "./session"

export interface Deps {
  readonly agents: Context.Service.Shape<typeof Agent.Service>
  readonly config: Context.Service.Shape<typeof Config.Service>
  readonly events: Context.Service.Shape<typeof EventV2Bridge.Service>
  readonly plugin: Context.Service.Shape<typeof Plugin.Service>
  readonly revert: Context.Service.Shape<typeof SessionRevert.Service>
  readonly sessions: Context.Service.Shape<typeof Session.Service>
  readonly spawner: Context.Service.Shape<typeof ChildProcessSpawner.ChildProcessSpawner>
  readonly state: Context.Service.Shape<typeof SessionRunState.Service>
  readonly currentModel: (sessionID: SessionID) => Effect.Effect<CurrentModel>
  readonly lastAssistant: (sessionID: SessionID) => Effect.Effect<SessionLegacy.WithParts>
}

/**
 * `!command` from the composer: the user runs a shell command and the turn is
 * recorded as a synthetic user message plus a shell tool part, so the model
 * sees it as ordinary history on the next turn.
 */
export function make(deps: Deps) {
  const { agents, config, events, plugin, revert, sessions, spawner, state, currentModel, lastAssistant } = deps

  const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
        const { msg, part, cwd } = yield* Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
          if (session.revert) {
            yield* revert.cleanup(session)
          }
          const agent = yield* agents.get(input.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
            throw error
          }
          const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
          const userMsg: SessionLegacy.User = {
            id: input.messageID ?? MessageID.ascending(),
            sessionID: input.sessionID,
            time: { created: Date.now() },
            role: "user",
            agent: input.agent,
            model: { providerID: model.providerID, modelID: model.modelID },
          }
          yield* sessions.setModel({
            sessionID: input.sessionID,
            model: {
              providerID: userMsg.model.providerID,
              id: userMsg.model.modelID,
            },
          })
          yield* sessions.updateMessage(userMsg)
          const userPart: SessionLegacy.Part = {
            type: "text",
            id: PartID.ascending(),
            messageID: userMsg.id,
            sessionID: input.sessionID,
            text: "The following tool was executed by the user",
            synthetic: true,
          }
          yield* sessions.updatePart(userPart)

          const msg: SessionLegacy.Assistant = {
            id: MessageID.ascending(),
            sessionID: input.sessionID,
            parentID: userMsg.id,
            mode: input.agent,
            agent: input.agent,
            cost: 0,
            path: { cwd: ctx.directory, root: ctx.worktree },
            time: { created: Date.now() },
            role: "assistant",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.modelID,
            providerID: model.providerID,
          }
          yield* sessions.updateMessage(msg)
          const started = Date.now()
          const part: SessionLegacy.ToolPart = {
            type: "tool",
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: input.sessionID,
            tool: ShellID.ToolID,
            callID: ulid(),
            state: {
              status: "running",
              time: { start: started },
              input: { command: input.command },
            },
          }
          yield* sessions.updatePart(part)
          return { msg, part, cwd: ctx.directory }
        }).pipe(Effect.ensuring(markReady))

        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const args = Shell.args(sh, input.command, cwd)
        let output = ""
        let aborted = false

        const finish = Effect.uninterruptible(
          Effect.gen(function* () {
            if (aborted) {
              output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
            }
            const completed = Date.now()
            if (!msg.time.completed) {
              msg.time.completed = completed
              yield* sessions.updateMessage(msg)
            }
            if (part.state.status === "running") {
              part.state = {
                status: "completed",
                time: { ...part.state.time, end: completed },
                input: part.state.input,
                title: "",
                metadata: { output, description: "" },
                output,
              }
              yield* sessions.updatePart(part)
            }
          }),
        )

        const exit = yield* restore(
          Effect.gen(function* () {
            const shellEnv = yield* plugin.trigger(
              "shell.env",
              { cwd, sessionID: input.sessionID, callID: part.callID },
              { env: {} },
            )
            const cmd = ChildProcess.make(sh, args, {
              cwd,
              extendEnv: true,
              env: { ...shellEnv.env, TERM: "dumb" },
              stdin: "ignore",
              forceKillAfter: "3 seconds",
            })
            const handle = yield* spawner.spawn(cmd)
            yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
              Effect.gen(function* () {
                output += chunk
                if (part.state.status === "running") {
                  part.state.metadata = { output, description: "" }
                  yield* sessions.updatePart(part)
                }
              }),
            )
            yield* handle.exitCode
          }).pipe(Effect.scoped, Effect.orDie),
        ).pipe(Effect.exit)

        if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
          aborted = true
        }
        yield* finish

        if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
          return yield* Effect.failCause(exit.cause)
        }

        return { info: msg, parts: [part] }
      }),
    )
  })

  const shell: (input: ShellInput) => Effect.Effect<SessionLegacy.WithParts, Session.BusyError> = Effect.fn(
    "SessionPrompt.shell",
  )(function* (input: ShellInput) {
    if (input.delivery === "immediate") yield* state.interrupt(input.sessionID)
    const ready = yield* Latch.make()
    return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
  })

  return { shellImpl, shell }
}
