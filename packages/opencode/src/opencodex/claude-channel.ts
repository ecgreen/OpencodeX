import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ClaudeEvent } from "./claude-mapper"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "claude-channel" })

/**
 * Persistent per-session Claude query channels (OpencodeX-div).
 *
 * The per-turn architecture spawned a fresh CLI child with `--resume` for
 * every turn. Resuming a conversation whose previous child died mid-turn made
 * the CLI emit an immediate close-out `result` for the dangling turn before
 * the new prompt's own events; the daemon read it as the new turn's
 * completion, tore the query down at +1s, and the child ran the real turn as
 * an orphan whose every canUseTool round trip aborted with "Stream closed"
 * (live capture 2026-08-22 16:35 UTC).
 *
 * A channel keeps one streaming-input query alive per session. Turns push a
 * user message and attach a sink; events route to the active turn. Two
 * structural guards kill the stale-result class:
 *
 * - a `result` arriving when no turn is active is dropped (logged), never
 *   surfaced as anyone's completion;
 * - a `result` arriving before the first assistant output after a resume
 *   spawn is dropped as the close-out of a previous dangling turn.
 *
 * The CLI child also survives between turns, so background tasks and the
 * permission control channel stop dying at turn boundaries.
 *
 * The channel is deliberately ignorant of what the handlers do: the SDK query
 * reads the current turn's handlers through `handlers()`, and between turns
 * there are none (the transport denies control requests arriving then).
 */

/** What the channel needs from the SDK query it wraps. */
export type ChannelQuery = {
  events: AsyncIterable<ClaudeEvent>
  interrupt: () => Promise<void>
  /** Hard teardown: abort the controller backing the query. */
  abort: () => void
}

export type CreateQuery<H> = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  handlers: () => H | undefined
  /** Conversation to resume, present only when the channel picks up an old one. */
  resumeID?: string
}) => Promise<ChannelQuery>

/** A push-driven AsyncIterable the SDK consumes as its prompt stream. */
export function createPushable<T>() {
  const queue: T[] = []
  let notify: (() => void) | undefined
  let ended = false
  return {
    push(value: T) {
      queue.push(value)
      notify?.()
    },
    end() {
      ended = true
      notify?.()
    },
    iterable: (async function* () {
      while (true) {
        while (queue.length > 0) yield queue.shift()!
        if (ended) return
        await new Promise<void>((resolve) => {
          notify = () => {
            notify = undefined
            resolve()
          }
        })
      }
    })() as AsyncIterable<T>,
  }
}

function eventType(event: ClaudeEvent) {
  return (event as { type?: string }).type ?? ""
}

function isAssistantOutput(event: ClaudeEvent) {
  const type = eventType(event)
  return type === "assistant" || type === "stream_event"
}

type TurnSink = {
  push: (event: ClaudeEvent) => void
  end: (failure?: { failure: unknown }) => void
  sawAssistantOutput: boolean
}

export class Channel<H> {
  private sink: TurnSink | undefined
  private queryPromise: Promise<ChannelQuery>
  private input = createPushable<SDKUserMessage>()
  private handlers: H | undefined
  /**
   * True until the first assistant output after a resume spawn: only inside
   * this window can the CLI's close-out result for a previous dangling turn
   * be mistaken for a live completion.
   */
  private settling: boolean
  /** True once the spawned CLI reported `system.init` (resume accepted). */
  private sawInit = false
  dead = false

  private readonly interruptGraceMs: number

  constructor(
    readonly key: string,
    createQuery: CreateQuery<H>,
    options?: { resumeID?: string; interruptGraceMs?: number },
  ) {
    this.interruptGraceMs = options?.interruptGraceMs ?? INTERRUPT_GRACE_MS
    this.settling = options?.resumeID !== undefined
    this.queryPromise = createQuery({
      prompt: this.input.iterable,
      handlers: () => this.handlers,
      ...(options?.resumeID ? { resumeID: options.resumeID } : {}),
    })
    void this.pump()
  }

  private async pump() {
    let failure: { failure: unknown } | undefined
    try {
      const query = await this.queryPromise
      for await (const event of query.events) this.route(event)
    } catch (error) {
      failure = { failure: error }
    }
    this.dead = true
    const sink = this.sink
    this.sink = undefined
    sink?.end(failure)
  }

  private route(event: ClaudeEvent) {
    if (eventType(event) === "system" && (event as { subtype?: string }).subtype === "init") this.sawInit = true
    const sink = this.sink
    if (!sink) {
      // No turn is consuming. A result here is exactly the stale close-out
      // this channel exists to contain; everything else between turns is
      // background chatter nothing downstream is keyed to receive.
      if (eventType(event) === "result") log.info("dropped out-of-turn result event", { channel: this.key })
      return
    }
    if (eventType(event) === "result" && this.settling && this.sawInit && !sink.sawAssistantOutput) {
      // Post-resume close-out of a dangling previous turn: after a successful
      // init it always precedes the new turn's own assistant output.
      // Forwarding it ended real turns at +1s with an empty transcript.
      // A result BEFORE init is deliberately forwarded - that is how a
      // rejected resume or an auth failure reports itself, and the mapper's
      // recovery (resumeRejected, needs-login) depends on seeing it.
      log.info("dropped post-resume close-out result", { channel: this.key })
      return
    }
    if (isAssistantOutput(event)) {
      sink.sawAssistantOutput = true
      this.settling = false
    }
    sink.push(event)
  }

  /**
   * Runs one turn: pushes the user message(s) and yields routed events until
   * the caller stops consuming (the driver breaks once the mapper reports the
   * turn finished) or the underlying query dies.
   */
  turn(messages: SDKUserMessage[], handlers: H) {
    if (this.dead) throw new Error("The Claude channel is closed.")
    if (this.sink) throw new Error("A turn is already active on this Claude channel.")
    this.handlers = handlers

    const buffered: ClaudeEvent[] = []
    let notify: (() => void) | undefined
    let ended: { failure?: unknown } | undefined
    const sink: TurnSink = {
      sawAssistantOutput: false,
      push: (event) => {
        buffered.push(event)
        notify?.()
      },
      end: (failure) => {
        ended = failure ? { failure: failure.failure } : {}
        notify?.()
      },
    }
    this.sink = sink

    for (const message of messages) this.input.push(message)

    const detach = () => {
      if (this.sink === sink) {
        this.sink = undefined
        this.handlers = undefined
      }
    }

    const channel = this
    async function* events(): AsyncGenerator<ClaudeEvent> {
      try {
        while (true) {
          while (buffered.length > 0) yield buffered.shift()!
          if (ended) {
            if ("failure" in ended) throw ended.failure
            return
          }
          await new Promise<void>((resolve) => {
            notify = () => {
              notify = undefined
              resolve()
            }
          })
        }
      } finally {
        detach()
      }
    }

    return {
      events: events() as AsyncIterable<ClaudeEvent>,
      interrupt: async () => {
        // Interrupt the turn, not the channel: the child survives for the
        // session's next turn. But a child too wedged to acknowledge the
        // interrupt (the failure class this channel exists for) must not hold
        // the session hostage: if the turn is still attached after the grace
        // window, the whole channel is torn down and the next turn respawns
        // with resume.
        const query = await channel.queryPromise.catch(() => undefined)
        await query?.interrupt().catch(() => undefined)
        setTimeout(() => {
          if (channel.sink === sink && !channel.dead) {
            log.warn("claude channel unresponsive to interrupt; closing", { channel: channel.key })
            void channel.close()
          }
        }, channel.interruptGraceMs).unref?.()
      },
    }
  }

  async close() {
    this.dead = true
    this.input.end()
    const sink = this.sink
    this.sink = undefined
    this.handlers = undefined
    const query = await this.queryPromise.catch(() => undefined)
    query?.abort()
    sink?.end()
  }
}

const INTERRUPT_GRACE_MS = 10_000

/**
 * Session-keyed registry. A turn whose config no longer matches the session's
 * live channel (model, effort, cwd, roster change) recycles it: the old child
 * is torn down and a fresh one resumes the same conversation.
 */
export function createChannelRegistry<H>() {
  const channels = new Map<string, { channel: Channel<H>; config: string }>()
  // Serializes acquires per key: two overlapping acquires must never both
  // decide to create, or the loser's live CLI child leaks unreachable.
  const pending = new Map<string, Promise<unknown>>()
  return {
    get: (sessionKey: string) => channels.get(sessionKey)?.channel,
    acquire(
      sessionKey: string,
      config: string,
      createQuery: CreateQuery<H>,
      options?: { resumeID?: string },
    ): Promise<Channel<H>> {
      const acquire = async () => {
        const existing = channels.get(sessionKey)
        if (existing && !existing.channel.dead && existing.config === config) return existing.channel
        if (existing) {
          channels.delete(sessionKey)
          await existing.channel.close().catch(() => undefined)
        }
        const channel = new Channel<H>(sessionKey, createQuery, options)
        channels.set(sessionKey, { channel, config })
        return channel
      }
      const chained = (pending.get(sessionKey) ?? Promise.resolve()).then(acquire, acquire)
      pending.set(
        sessionKey,
        chained.catch(() => undefined),
      )
      return chained
    },
    async closeAll() {
      const open = [...channels.values()]
      channels.clear()
      await Promise.all(open.map((entry) => entry.channel.close().catch(() => undefined)))
    },
  }
}

export type ChannelRegistry<H> = ReturnType<typeof createChannelRegistry<H>>

export * as ClaudeChannel from "./claude-channel"
