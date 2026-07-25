import { Context, Effect, Layer, Option } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import { EffectBridge } from "@/effect/bridge"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { ClaudeDriverMetadata } from "./claude-driver-metadata"
import { ClaudeHandoff } from "./claude-handoff"
import { ClaudeMapper, type ClaudeEvent, type MapperContext } from "./claude-mapper"
import { ClaudePermission } from "./claude-permission"
import { ClaudeTransport, createSdkTransport, type ClaudeTransport as Transport } from "./claude-transport"

type SessionID = typeof SessionSchema.ID.Type

/**
 * Runs a session's turns through the user's local Claude Code CLI in headless
 * mode and writes the conversation into the session as native transcript parts.
 *
 * It deliberately depends on neither SessionPrompt nor SessionRunState: the
 * session loop already owns the user message and the execution lease, and calls
 * `runTurn` as its work effect. Keeping those out also keeps the import graph
 * acyclic, since SessionPrompt is what branches here.
 */
export interface Interface {
  readonly runTurn: (input: {
    sessionID: SessionID
    parentMessageID: typeof SessionLegacy.MessageID.Type
    text: string
    directory: string
    /** The catalog route the turn was started on, e.g. `claude-code/sonnet`. */
    providerID: string
    modelID: string
    /** The selected variant, which for this provider is the effort level. */
    variant?: string
  }) => Effect.Effect<SessionLegacy.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXClaudeDriver") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const permission = yield* Permission.Service
    const decide = ClaudePermission.decideWith(permission)
    const transport: Transport = createSdkTransport()

    const runTurn = Effect.fn("OpencodeXClaudeDriver.runTurn")(function* (input: {
      sessionID: SessionID
      parentMessageID: typeof SessionLegacy.MessageID.Type
      text: string
      directory: string
      providerID: string
      modelID: string
      variant?: string
    }) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      const conversation = ClaudeDriverMetadata.readConversation(session.metadata)
      // Only an id Claude issued can be resumed. The first turn passes none and
      // adopts whatever `system.init` reports; every later turn resumes that.
      const resumeID = conversation?.conversationID

      const context: MapperContext = {
        sessionID: input.sessionID,
        parentMessageID: input.parentMessageID,
        directory: input.directory,
        providerID: input.providerID,
        modelID: input.modelID,
        nextMessageID: () => SessionLegacy.MessageID.ascending(),
        nextPartID: () => SessionLegacy.PartID.ascending(),
        now: () => Date.now(),
      }
      let live = ClaudeMapper.initialState({
        modelID: conversation?.modelID,
        billed: conversation?.billed,
      })

      const executable = yield* Effect.promise(() => ClaudeTransport.resolveClaudeExecutable())
      if (!executable) {
        return yield* failTurn(
          context,
          live,
          "Claude Code was not found. Install it from code.claude.com/docs/en/installation, then try again.",
          "missing-cli",
        )
      }

      // Claude keeps its own conversation state, so anything that came before is
      // invisible to a conversation it has not been resuming. Replay it once,
      // when opening a new one on a session that already has history.
      const prompt = resumeID ? input.text : yield* primedPrompt(input.sessionID, input.parentMessageID, input.text)

      // Captured here so a permission prompt raised inside Claude's callback
      // still carries this request's instance and workspace context.
      const bridge = yield* EffectBridge.make()
      const turn = transport.run(prompt, {
        cwd: input.directory,
        ...(resumeID ? { resumeID } : {}),
        executable,
        model: input.modelID,
        ...(input.variant ? { effort: input.variant } : {}),
        canUseTool: (toolName, toolInput, toolUseID) =>
          bridge
            .promise(
              decide({
                sessionID: input.sessionID,
                toolName,
                toolInput,
                messageID: live.messageID,
                callID: toolUseID,
              }),
            )
            .catch(() => ({ allow: false as const, message: "The permission request failed." })),
      })

      const finalize = Effect.fn("OpencodeXClaudeDriver.finalize")(function* (reason: string, error?: string) {
        const closing = ClaudeMapper.finalizeAbandonedTurn(live, context, { reason, ...(error ? { error } : {}) })
        live = closing.state
        yield* applyWrites(closing.writes, input.sessionID)
      })

      const iterator = turn.events[Symbol.asyncIterator]()
      let failure: unknown
      while (true) {
        const next = yield* Effect.promise(() =>
          iterator.next().catch((cause: unknown) => ({ done: true as const, value: undefined, failure: cause })),
        )
        const raised = (next as { failure?: unknown }).failure
        if (raised) {
          failure = raised
          break
        }
        if (next.done) break
        const mapped = ClaudeMapper.mapEvent(next.value as ClaudeEvent, live, context)
        live = mapped.state
        yield* applyWrites(mapped.writes, input.sessionID)
        if (live.finished) break
      }

      if (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        yield* finalize("error", message)
      } else if (!live.finished) {
        yield* finalize("stop")
      }

      // A resume that Claude rejected leaves the stored id unusable, so drop it
      // and let the next turn open a fresh conversation instead of failing forever.
      const nextID = live.claudeSessionID ?? (live.resumeRejected ? undefined : resumeID)
      yield* sessions
        .setMetadata({
          sessionID: input.sessionID,
          metadata: ClaudeDriverMetadata.withConversation(session.metadata, {
            ...(nextID ? { conversationID: nextID } : {}),
            launched: true,
            modelID: live.modelID,
            billed: live.billed,
            ...(live.authFailed ? { authState: "needs-login" as const } : { authState: "ready" as const }),
          }),
        })
        .pipe(Effect.ignore)

      return yield* readTurn(input.sessionID, live.messageID)
    })

    /**
     * Prefixes the earlier transcript when Claude is taking over a session that
     * was already running. Everything from `parentMessageID` onward is the turn
     * being sent right now, so it is excluded.
     */
    const primedPrompt = Effect.fnUntraced(function* (
      sessionID: SessionID,
      parentMessageID: typeof SessionLegacy.MessageID.Type,
      text: string,
    ) {
      const history = yield* sessions.messages({ sessionID }).pipe(Effect.orElseSucceed(() => []))
      const prior = history.slice(0, Math.max(0, history.findIndex((message) => message.info.id === parentMessageID)))
      return ClaudeHandoff.withHandoff(text, prior)
    })

    /** Writes a single failed assistant turn when the CLI cannot even start. */
    const failTurn = Effect.fn("OpencodeXClaudeDriver.failTurn")(function* (
      context: MapperContext,
      state: ClaudeMapper.MapperState,
      message: string,
      code: string,
    ) {
      const opened = ClaudeMapper.startTurn(state, context)
      const closing = ClaudeMapper.finalizeAbandonedTurn(opened.state, context, { reason: code, error: message })
      yield* applyWrites([...opened.writes, ...closing.writes], context.sessionID)
      return yield* readTurn(context.sessionID, closing.state.messageID)
    })

    const applyWrites = Effect.fn("OpencodeXClaudeDriver.applyWrites")(function* (
      writes: ClaudeMapper.SessionWrite[],
      sessionID: SessionID,
    ) {
      for (const write of writes) {
        if (write.kind === "message") yield* sessions.updateMessage(write.message)
        else if (write.kind === "part") yield* sessions.updatePart(write.part)
        else yield* todos.update({ sessionID, todos: write.todos as never }).pipe(Effect.ignore)
      }
    })

    const readTurn = Effect.fn("OpencodeXClaudeDriver.readTurn")(function* (
      sessionID: SessionID,
      messageID?: typeof SessionLegacy.MessageID.Type,
    ) {
      const empty = { info: { id: messageID ?? "", sessionID }, parts: [] } as unknown as SessionLegacy.WithParts
      if (!messageID) return empty
      const found = yield* sessions
        .findMessage(sessionID, (message) => message.info.id === messageID)
        .pipe(Effect.orDie)
      return Option.getOrElse(found, () => empty)
    })

    return Service.of({ runTurn })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(Permission.defaultLayer),
)

export * as OpencodeXClaudeDriver from "./claude-driver"
