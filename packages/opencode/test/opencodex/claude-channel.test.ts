import { describe, expect, test } from "bun:test"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { Channel, createChannelRegistry, createPushable, type CreateQuery } from "../../src/opencodex/claude-channel"
import type { ClaudeEvent } from "../../src/opencodex/claude-mapper"

type Handlers = { name: string }

/** A scriptable stand-in for the SDK query a channel wraps. */
function fakeQuery() {
  const stream = createPushable<ClaudeEvent>()
  const state = {
    prompts: [] as SDKUserMessage[],
    resumeID: undefined as string | undefined,
    interrupts: 0,
    aborted: false,
    handlers: undefined as (() => Handlers | undefined) | undefined,
  }
  const create: CreateQuery<Handlers> = async (input) => {
    state.resumeID = input.resumeID
    state.handlers = input.handlers
    void (async () => {
      for await (const message of input.prompt) state.prompts.push(message)
    })()
    return {
      events: stream.iterable,
      interrupt: async () => {
        state.interrupts += 1
      },
      abort: () => {
        state.aborted = true
        stream.end()
      },
    }
  }
  return { create, emit: stream.push.bind(stream), endStream: stream.end.bind(stream), state }
}

function user(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage
}

const assistant = { type: "assistant", message: { content: [] } } as unknown as ClaudeEvent
const result = { type: "result", subtype: "success" } as unknown as ClaudeEvent
const init = { type: "system", subtype: "init", session_id: "conv-1" } as unknown as ClaudeEvent

async function collect(events: AsyncIterable<ClaudeEvent>, count: number) {
  const seen: ClaudeEvent[] = []
  for await (const event of events) {
    seen.push(event)
    if (seen.length >= count) break
  }
  return seen
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe("claude channel", () => {
  test("drops the post-resume close-out result instead of ending the live turn", async () => {
    // The live capture (2026-08-22 16:35 UTC): a resume spawn emitted a stale
    // result +1s after start, before the new turn produced anything; the
    // daemon read it as the turn's completion and orphaned the real turn.
    const { create, emit, state } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create, { resumeID: "conv-1" })
    const turn = channel.turn([user("wake")], { name: "t1" })

    await settled()
    expect(state.resumeID).toBe("conv-1")
    emit(init) // the resume was accepted
    emit(result) // stale close-out of the dangling previous turn
    emit(assistant)
    emit(result) // the real completion

    const seen = await collect(turn.events, 3)
    expect(seen.map((event) => (event as { type: string }).type)).toEqual(["system", "assistant", "result"])
  })

  test("forwards a pre-init result so a rejected resume still reaches the mapper", async () => {
    // A resume the CLI refuses (or an auth failure) reports itself as a failed
    // result with no system.init; the mapper's resumeRejected/needs-login
    // recovery depends on seeing it. Only post-init results can be stale.
    const { create, emit } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create, { resumeID: "conv-gone" })
    const turn = channel.turn([user("wake")], { name: "t1" })
    emit({ type: "result", subtype: "error_during_execution", is_error: true } as unknown as ClaudeEvent)
    const seen = await collect(turn.events, 1)
    expect((seen[0] as { type: string }).type).toBe("result")
  })

  test("forwards results normally on a channel that did not resume", async () => {
    const { create, emit } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)
    const turn = channel.turn([user("hi")], { name: "t1" })
    emit(result)
    const seen = await collect(turn.events, 1)
    expect((seen[0] as { type: string }).type).toBe("result")
  })

  test("drops results that arrive between turns", async () => {
    const { create, emit } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)
    const first = channel.turn([user("one")], { name: "t1" })
    emit(assistant)
    emit(result)
    await collect(first.events, 2)

    // Nobody is consuming: background chatter and stray results must not leak
    // into the next turn.
    emit(result)
    emit({ type: "system", subtype: "task_done" } as unknown as ClaudeEvent)
    await settled()

    const second = channel.turn([user("two")], { name: "t2" })
    emit(assistant)
    const seen = await collect(second.events, 1)
    expect((seen[0] as { type: string }).type).toBe("assistant")
  })

  test("runs consecutive turns over one query and swaps handlers per turn", async () => {
    const { create, emit, state } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)

    const first = channel.turn([user("one")], { name: "t1" })
    await settled()
    expect(state.handlers?.()).toEqual({ name: "t1" })
    emit(assistant)
    emit(result)
    await collect(first.events, 2)
    // Between turns there is no handler to answer control requests.
    expect(state.handlers?.()).toBeUndefined()

    const second = channel.turn([user("two")], { name: "t2" })
    await settled()
    expect(state.handlers?.()).toEqual({ name: "t2" })
    emit(assistant)
    await collect(second.events, 1)
    expect(state.prompts.map((message) => message.message.content)).toEqual(["one", "two"])
  })

  test("ends the turn's events when the underlying query dies", async () => {
    const { create, emit, endStream } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)
    const turn = channel.turn([user("hi")], { name: "t1" })
    emit(assistant)
    const seen: ClaudeEvent[] = []
    for await (const event of turn.events) {
      seen.push(event)
      if (seen.length === 1) endStream()
    }
    expect(seen).toHaveLength(1)
    expect(channel.dead).toBe(true)
    expect(() => channel.turn([user("again")], { name: "t2" })).toThrow("closed")
  })

  test("supports the driver's manual-iterator pattern across turns", async () => {
    // The driver consumes via iterator.next() and breaks on the mapper's
    // finished flag, then calls iterator.return() explicitly. A turn released
    // that way must leave the channel ready for the session's next turn.
    const { create, emit } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)

    const first = channel.turn([user("one")], { name: "t1" })
    const iterator = (first.events as AsyncGenerator<ClaudeEvent>)[Symbol.asyncIterator]()
    emit(assistant)
    emit(result)
    await iterator.next()
    await iterator.next()
    // The driver saw finished and breaks - manual iteration performs no
    // implicit cleanup, so it must release explicitly.
    await iterator.return?.(undefined)

    const second = channel.turn([user("two")], { name: "t2" })
    emit(assistant)
    const seen = await collect(second.events, 1)
    expect((seen[0] as { type: string }).type).toBe("assistant")
  })

  test("closes a channel whose child ignores an interrupt", async () => {
    const { create, state } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create, { interruptGraceMs: 20 })
    const turn = channel.turn([user("one")], { name: "t1" })
    await turn.interrupt()
    expect(state.interrupts).toBe(1)
    // The child never acknowledges: no events, no stream end. After the grace
    // window the channel must tear itself down rather than wedge the session.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(channel.dead).toBe(true)
    expect(state.aborted).toBe(true)
  })

  test("rejects a second concurrent turn", async () => {
    const { create } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)
    channel.turn([user("one")], { name: "t1" })
    expect(() => channel.turn([user("two")], { name: "t2" })).toThrow("already active")
  })

  test("interrupt reaches the query without killing the channel", async () => {
    const { create, emit, state } = fakeQuery()
    const channel = new Channel<Handlers>("s1", create)
    const turn = channel.turn([user("one")], { name: "t1" })
    await turn.interrupt()
    expect(state.interrupts).toBe(1)
    expect(channel.dead).toBe(false)
    emit(assistant)
    await collect(turn.events, 1)
  })
})

describe("channel registry", () => {
  test("reuses a live channel with the same config and recycles on change", async () => {
    const registry = createChannelRegistry<Handlers>()
    const first = fakeQuery()
    const channel1 = await registry.acquire("session", "config-a", first.create)
    const channel2 = await registry.acquire("session", "config-a", fakeQuery().create)
    expect(channel2).toBe(channel1)

    const second = fakeQuery()
    const channel3 = await registry.acquire("session", "config-b", second.create, { resumeID: "conv-9" })
    expect(channel3).not.toBe(channel1)
    expect(channel1.dead).toBe(true)
    expect(first.state.aborted).toBe(true)
    await settled()
    expect(second.state.resumeID).toBe("conv-9")
  })

  test("replaces a dead channel even with an unchanged config", async () => {
    const registry = createChannelRegistry<Handlers>()
    const first = fakeQuery()
    const channel1 = await registry.acquire("session", "config-a", first.create)
    first.endStream()
    await settled()
    expect(channel1.dead).toBe(true)
    const channel2 = await registry.acquire("session", "config-a", fakeQuery().create, { resumeID: "conv-2" })
    expect(channel2).not.toBe(channel1)
  })

  test("closeAll tears every channel down", async () => {
    const registry = createChannelRegistry<Handlers>()
    const one = fakeQuery()
    const two = fakeQuery()
    const a = await registry.acquire("s1", "c", one.create)
    const b = await registry.acquire("s2", "c", two.create)
    await registry.closeAll()
    expect(a.dead).toBe(true)
    expect(b.dead).toBe(true)
    expect(one.state.aborted).toBe(true)
    expect(two.state.aborted).toBe(true)
  })
})
