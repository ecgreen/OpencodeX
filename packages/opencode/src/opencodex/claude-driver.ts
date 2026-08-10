import { Context, Effect, Layer, Option } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import { Agent } from "@/agent/agent"
import { EffectBridge } from "@/effect/bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { ClaudeDriverMetadata } from "./claude-driver-metadata"
import { ClaudeHandoff } from "./claude-handoff"
import { ClaudeMapper, type MapperContext } from "./claude-mapper"
import { ClaudePermission } from "./claude-permission"
import { ClaudeSidechain } from "./claude-sidechain"
import {
  ClaudeTransport,
  createSdkTransport,
  type ClaudeTransport as Transport,
  type DelegateCapability,
} from "./claude-transport"

type SessionID = typeof SessionSchema.ID.Type

/**
 * Tools that are Claude's own control flow rather than actions the permission
 * system is meant to gate. Exported so a test can pin the list against the
 * mapper's normalized names.
 */
export const CLAUDE_CONTROL_FLOW: Permission.Ruleset = [
  { permission: "plan_exit", pattern: "*", action: "allow" },
]

/**
 * Runs a session's turns through the user's local Claude Code CLI in headless
 * mode and writes the conversation into the session as native transcript parts.
 *
 * It deliberately depends on neither SessionPrompt nor SessionRunState: the
 * session loop already owns the user message and the execution lease, and calls
 * `runTurn` as its work effect. Keeping those out also keeps the import graph
 * acyclic, since SessionPrompt is what branches here.
 */
/**
 * Swarm delegation as the session loop supplies it: Effect-returning, so the
 * caller stays in Effect-land. The driver bridges it to the Promise the CLI's
 * in-process tool needs, on the same captured bridge as permission prompts.
 */
export type SwarmDelegate = {
  roles: Array<{ name: string; description?: string }>
  run: (input: { role: string; prompt: string }) => Effect.Effect<string>
}

export interface Interface {
  readonly runTurn: (input: {
    sessionID: SessionID
    parentMessageID: typeof SessionLegacy.MessageID.Type
    text: string
    directory: string
    /**
     * The catalog route the reader picked, used for transcript attribution.
     * For a swarm that is `swarm/<id>`, which is deliberately not the value the
     * CLI runs - see `claudeModelID`.
     */
    providerID: string
    modelID: string
    /** The model value handed to the CLI; defaults to `modelID`. */
    claudeModelID?: string
    /** The selected variant, which for this provider is the effort level. */
    variant?: string
    /**
     * Present when the turn is a swarm orchestrator: gives the CLI a tool that
     * runs specialist roles back inside OpencodeX on their own models.
     */
    delegate?: SwarmDelegate
    /**
     * Present when the caller can turn a Claude subagent (sidechain) into a
     * real child session. Without it, sidechain events fall through to the
     * main mapper untouched (today's behavior).
     */
    sidechain?: {
      spawn: (input: { title: string; prompt: string }) => Effect.Effect<{ sessionID: string; userMessageID: string }>
    }
  }) => Effect.Effect<SessionLegacy.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXClaudeDriver") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service
    const agents = yield* Agent.Service
    const decide = ClaudePermission.decideWith(permission, question)
    const transport: Transport = createSdkTransport()

    const runTurn = Effect.fn("OpencodeXClaudeDriver.runTurn")(function* (input: {
      sessionID: SessionID
      parentMessageID: typeof SessionLegacy.MessageID.Type
      text: string
      directory: string
      providerID: string
      modelID: string
      claudeModelID?: string
      variant?: string
      delegate?: SwarmDelegate
      sidechain?: {
        spawn: (input: { title: string; prompt: string }) => Effect.Effect<{ sessionID: string; userMessageID: string }>
      }
    }) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      // Resolved per turn rather than per layer: `Agent.defaultInfo` re-reads
      // `opencodex.json` on every call and applies the user's `permission_mode`
      // to the ruleset, so switching modes in the GUI takes effect on the next
      // turn instead of needing a restart.
      const permissionAgent = yield* agents.defaultInfo()
      const ruleset = Permission.merge(
        permissionAgent?.permission ?? [],
        session.permission ?? [],
        // `ExitPlanMode` normalizes onto `plan_exit`, which the default ruleset
        // denies because it is an OpencodeX tool a model should not call
        // directly. In a mirrored session it is Claude's own control flow, and
        // the CLI has no way to recover from a denial - it would simply be
        // unable to leave plan mode. Appended last so it wins the match.
        CLAUDE_CONTROL_FLOW,
      )
      const conversation = ClaudeDriverMetadata.readConversation(session.metadata)
      // Only an id Claude issued can be resumed. The first turn passes none and
      // adopts whatever `system.init` reports; every later turn resumes that.
      const resumeID = conversation?.conversationID

      // When the permission gate rewrites a call's input - the AskUserQuestion
      // answers come back that way - the transcript should record what was
      // actually approved, not the model's original request. The decision
      // always resolves before the CLI executes the tool, so the entry is in
      // place by the time the tool_result event is mapped.
      const decidedInputs = new Map<string, Record<string, unknown>>()
      const context: MapperContext = {
        sessionID: input.sessionID,
        parentMessageID: input.parentMessageID,
        directory: input.directory,
        providerID: input.providerID,
        modelID: input.modelID,
        nextMessageID: () => SessionLegacy.MessageID.ascending(),
        nextPartID: () => SessionLegacy.PartID.ascending(),
        now: () => Date.now(),
        decidedInput: (callID) => decidedInputs.get(callID),
      }
      let live = ClaudeMapper.initialState({
        modelID: conversation?.modelID,
        billed: conversation?.billed,
        tasks: conversation?.tasks,
      })

      // Present only when the caller (prompt-swarm) can turn a Claude subagent
      // into a real child session. Sidechains are Claude's own event stream,
      // tagged with `parent_tool_use_id` - see claude-sidechain.ts.
      const sidechain = input.sidechain
        ? ClaudeSidechain.createSidechainRouter({
            makeContext: (sessionID, parentMessageID) => ({
              ...context,
              sessionID: sessionID as typeof context.sessionID,
              parentMessageID: parentMessageID as typeof context.parentMessageID,
            }),
          })
        : undefined

      // Recursive because attaching a child can immediately flush buffered
      // writes for it, which themselves need to be interpreted. Declared here
      // (rather than alongside `applyWrites`) so it closes over `input` and
      // `sidechain`.
      const interpretSidechainActions: (actions: ClaudeSidechain.SidechainAction[]) => Effect.Effect<void> = Effect.fn(
        "OpencodeXClaudeDriver.sidechain",
      )(function* (actions) {
        for (const action of actions) {
          if (action.kind === "spawn") {
            const child = yield* input
              .sidechain!.spawn({ title: action.title, prompt: action.prompt })
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (child) {
              const flushed = sidechain!.attachChild(action.chainID, child.sessionID, child.userMessageID)
              yield* interpretSidechainActions(flushed)
            }
            continue
          }
          yield* applyWrites(action.writes, action.sessionID as SessionID)
        }
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
        model: input.claudeModelID ?? input.modelID,
        ...(input.variant ? { effort: input.variant } : {}),
        ...(input.delegate
          ? {
              delegate: {
                roles: input.delegate.roles,
                run: (delegated) =>
                  bridge
                    .promise(input.delegate!.run(delegated))
                    .catch((cause: unknown) =>
                      `Delegation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                    ),
              } satisfies DelegateCapability,
            }
          : {}),
        canUseTool: (toolName, toolInput, toolUseID) =>
          bridge
            .promise(
              decide({
                sessionID: input.sessionID,
                toolName,
                toolInput,
                messageID: live.messageID,
                callID: toolUseID,
                ruleset,
              }),
            )
            .then((decision) => {
              if (decision.allow && decision.input && toolUseID) decidedInputs.set(toolUseID, decision.input)
              return decision
            })
            .catch(() => ({ allow: false as const, message: "The permission request failed." })),
      })

      const finalize = Effect.fn("OpencodeXClaudeDriver.finalize")(function* (reason: string, error?: string) {
        const closing = ClaudeMapper.finalizeAbandonedTurn(live, context, { reason, ...(error ? { error } : {}) })
        live = closing.state
        yield* applyWrites(closing.writes, input.sessionID)
      })

      const saveConversation = Effect.fn("OpencodeXClaudeDriver.saveConversation")(function* () {
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
              ...(live.tasks.size > 0 ? { tasks: [...live.tasks].map(([id, task]) => ({ id, ...task })) } : {}),
            }),
          })
          .pipe(Effect.ignore)
      })

      const iterator = turn.events[Symbol.asyncIterator]()
      let failure: unknown
      const consume = Effect.gen(function* () {
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
          if (sidechain) {
            const routed = sidechain.route(next.value, live.toolParts)
            yield* interpretSidechainActions(routed.actions)
            if (routed.handled) continue
          }
          const mapped = ClaudeMapper.mapEvent(next.value, live, context)
          live = mapped.state
          yield* applyWrites(mapped.writes, input.sessionID)
          if (live.finished) break
        }
      })
      // Stopping the session interrupts this fiber, and interruption must reach
      // the CLI subprocess: without the explicit `interrupt` the child keeps
      // running headless, and without `finalize` its tool parts stay "running"
      // in the transcript forever. Runs in the interrupt handler because the
      // code after this pipe never executes on an interrupted fiber.
      yield* consume.pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* Effect.promise(() => turn.interrupt().catch(() => undefined))
            yield* finalize("abort")
            if (sidechain) yield* interpretSidechainActions(sidechain.finalizeAll())
            yield* saveConversation()
          }),
        ),
      )

      if (failure) {
        // `failure` is whatever the SDK iterator threw; String() on an object
        // would surface a useless "[object Object]" in the transcript.
        const message =
          failure instanceof Error ? failure.message : typeof failure === "string" ? failure : JSON.stringify(failure)
        yield* finalize("error", message)
      } else if (!live.finished) {
        yield* finalize("stop")
      }

      // Any sidechain still open when the turn ends (the main turn finished,
      // errored, or hit its stop reason before the subagent's own tool_result
      // arrived) is abandoned - close it the same way `finalize` closes the
      // main turn, so its transcript never shows a part stuck "running".
      if (sidechain) yield* interpretSidechainActions(sidechain.finalizeAll())

      yield* saveConversation()

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
  Layer.provide(Question.defaultLayer),
  Layer.provide(Agent.defaultLayer),
)

export * as OpencodeXClaudeDriver from "./claude-driver"
