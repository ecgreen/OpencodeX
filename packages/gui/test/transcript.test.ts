import type { Part, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import type { MessageBundle } from "../src/renderer/src/lib/session-api"
import { formatSessionTranscript } from "../src/renderer/src/lib/transcript"
import {
  TRANSCRIPT_PROMPT_HISTORY_LIMIT,
  TRANSCRIPT_PROMPT_PREVIEW_LENGTH,
  samePromptEntries,
  transcriptPromptHistory,
  visibleTranscriptMessageIDs,
  visibleTranscriptMessages,
} from "../src/renderer/src/lib/transcript-visibility"

describe("GUI session transcript formatting", () => {
  test("includes thinking and tool details by default", () => {
    const transcript = formatSessionTranscript({
      session: session(),
      messages: [assistantMessage()],
      providers: providers(),
    })

    expect(transcript).toContain("## Assistant (Claude Sonnet)")
    expect(transcript).toContain("_Thinking:_")
    expect(transcript).toContain("hidden chain")
    expect(transcript).toContain("**Input:**")
    expect(transcript).toContain('"command": "echo ok"')
    expect(transcript).toContain("**Output:**")
    expect(transcript).toContain("ok")
  })

  test("respects hidden thinking, tool detail, and assistant metadata options", () => {
    const transcript = formatSessionTranscript({
      session: session(),
      messages: [assistantMessage()],
      providers: providers(),
      options: {
        thinking: false,
        toolDetails: false,
        assistantMetadata: false,
      },
    })

    expect(transcript).toContain("## Assistant\n")
    expect(transcript).not.toContain("Claude Sonnet")
    expect(transcript).not.toContain("hidden chain")
    expect(transcript).not.toContain("**Input:**")
    expect(transcript).not.toContain("**Output:**")
    expect(transcript).toContain("**Tool:**")
  })

  test("hides synthetic user-only transcript messages", () => {
    const messages = [
      userMessage("msg_compaction", [compactionPart()]),
      userMessage("msg_blank", [textPart("")]),
      userMessage("msg_real", [textPart("actual input"), compactionPart()]),
    ]
    const result = visibleTranscriptMessages(messages)

    expect(visibleTranscriptMessageIDs(messages)).toEqual(["msg_real"])
    expect(result.map((message) => message.info.id)).toEqual(["msg_real"])
    expect(result[0].parts.map((part) => part.type)).toEqual(["text"])
  })

  test("uses provenance rather than internal-looking markup to decide visibility", () => {
    const literal = textPart("<swarm-briefing>literal user text</swarm-briefing>")
    const synthetic = textPart("<swarm-briefing>internal</swarm-briefing>", { synthetic: true })
    const messages = [userMessage("msg_literal", [literal]), userMessage("msg_internal", [synthetic])]

    expect(visibleTranscriptMessageIDs(messages)).toEqual(["msg_literal"])
    expect(visibleTranscriptMessages(messages)[0].parts).toEqual([literal])
  })

  test("preserves unchanged visible message identities", () => {
    const first = userMessage("msg_first", [textPart("first")])
    const second = userMessage("msg_second", [textPart("second")])
    const result = visibleTranscriptMessages([first, second])

    expect(result[0]).toBe(first)
    expect(result[1]).toBe(second)
  })

  test("keeps interrupted work without showing an error when the next message steers it", () => {
    const interrupted = assistantMessage()
    if (interrupted.info.role === "assistant") {
      interrupted.info.error = { name: "MessageAbortedError", data: { message: "Aborted" } }
    }
    const direction = userMessage("msg_direction", [
      textPart("focus on the regression test"),
      {
        ...textPart("continue the task"),
        id: "prt_steering",
        messageID: "msg_direction",
        synthetic: true,
        metadata: { steering: true },
      } as Part,
    ])

    const result = visibleTranscriptMessages([interrupted, direction])

    expect(result.map((message) => message.info.id)).toEqual(["msg_assistant", "msg_direction"])
    expect(result[0].info.role === "assistant" ? result[0].info.error : undefined).toBeUndefined()
    expect(interrupted.info.role === "assistant" ? interrupted.info.error?.name : undefined).toBe("MessageAbortedError")
    expect(result[1].parts).toHaveLength(1)
  })

  test("keeps an interruption error when the next message is not steering", () => {
    const interrupted = assistantMessage()
    if (interrupted.info.role === "assistant") {
      interrupted.info.error = { name: "MessageAbortedError", data: { message: "Aborted" } }
    }

    const result = visibleTranscriptMessages([interrupted, userMessage("msg_next", [textPart("new task")])])

    expect(result[0].info.role === "assistant" ? result[0].info.error?.name : undefined).toBe("MessageAbortedError")
  })
})

describe("GUI transcript prompt history", () => {
  test("keeps only the newest eight prompts in chronological order", () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      userMessage(`msg_${index}`, [textPart(`prompt ${index}`)]),
    )

    const entries = transcriptPromptHistory(messages)

    expect(TRANSCRIPT_PROMPT_HISTORY_LIMIT).toBe(8)
    expect(entries).toHaveLength(8)
    expect(entries[0]).toEqual({ messageID: "msg_2", text: "prompt 2" })
    expect(entries.at(-1)).toEqual({ messageID: "msg_9", text: "prompt 9" })
  })

  test("excludes assistant turns and non-prompt user messages", () => {
    const messages = [
      assistantMessage(),
      userMessage("msg_compaction", [compactionPart()]),
      userMessage("msg_blank", [textPart("   ")]),
      userMessage("msg_synthetic", [{ ...textPart("steering"), synthetic: true } as Part]),
      userMessage("msg_ignored", [{ ...textPart("hidden"), ignored: true } as Part]),
      userMessage("msg_real", [textPart("actual input")]),
    ]

    expect(transcriptPromptHistory(messages)).toEqual([{ messageID: "msg_real", text: "actual input" }])
  })

  test("joins visible text parts and collapses whitespace", () => {
    const messages = [
      userMessage("msg_multi", [textPart("first  line\n\nsecond line"), compactionPart(), textPart("third part")]),
    ]

    expect(transcriptPromptHistory(messages)).toEqual([
      { messageID: "msg_multi", text: "first line second line third part" },
    ])
  })

  test("truncates long prompts with an ellipsis", () => {
    const long = "word ".repeat(200).trim()
    const [entry] = transcriptPromptHistory([userMessage("msg_long", [textPart(long)])])

    expect(entry.text.length).toBeLessThanOrEqual(TRANSCRIPT_PROMPT_PREVIEW_LENGTH)
    expect(entry.text.endsWith("…")).toBe(true)
  })

  test("streaming re-extractions compare content-equal so the rail never re-renders", () => {
    const messages = [userMessage("msg_a", [textPart("first")]), userMessage("msg_b", [textPart("second")])]
    // Two runs build fresh objects, as happens on every streaming chunk.
    const before = transcriptPromptHistory(messages)
    const after = transcriptPromptHistory(messages)

    expect(after).not.toBe(before)
    expect(samePromptEntries(before, after)).toBe(true)
    expect(samePromptEntries(undefined, after)).toBe(false)
    expect(samePromptEntries(before, transcriptPromptHistory(messages.slice(0, 1)))).toBe(false)
    expect(samePromptEntries(before, transcriptPromptHistory([messages[0], userMessage("msg_b", [textPart("edited")])]))).toBe(false)
  })

  test("keeps duplicate prompt texts as distinct entries", () => {
    const messages = [
      userMessage("msg_a", [textPart("run the tests")]),
      userMessage("msg_b", [textPart("run the tests")]),
    ]

    expect(transcriptPromptHistory(messages).map((entry) => entry.messageID)).toEqual(["msg_a", "msg_b"])
  })
})

function session(): Session {
  return {
    id: "ses_test",
    title: "Parity session",
    directory: "C:\\Work\\OpencodeX",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
    cost: 0,
  } as Session
}

function assistantMessage(): MessageBundle {
  return {
    info: {
      id: "msg_assistant",
      sessionID: "ses_test",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-sonnet",
      agent: "build",
      mode: "build",
      path: { cwd: "C:\\Work\\OpencodeX", root: "C:\\Work\\OpencodeX" },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
    },
    parts: [textPart("Visible answer"), reasoningPart("hidden chain"), toolPart()],
  } as MessageBundle
}

function userMessage(id: string, parts: Part[]): MessageBundle {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role: "user",
      time: { created: 1_700_000_000_000 },
    },
    parts,
  } as MessageBundle
}

function textPart(text: string, flags?: { synthetic?: boolean; ignored?: boolean }): Part {
  return {
    id: "prt_text",
    sessionID: "ses_test",
    messageID: "msg_assistant",
    type: "text",
    text,
    ...flags,
  } as Part
}

function reasoningPart(text: string): Part {
  return {
    id: "prt_reasoning",
    sessionID: "ses_test",
    messageID: "msg_assistant",
    type: "reasoning",
    text,
  } as Part
}

function toolPart(): Part {
  return {
    id: "prt_tool",
    sessionID: "ses_test",
    messageID: "msg_assistant",
    type: "tool",
    tool: "bash",
    callID: "call_test",
    state: {
      status: "completed",
      input: { command: "echo ok" },
      output: "ok",
    },
  } as Part
}

function compactionPart(): Part {
  return {
    id: "prt_compaction",
    sessionID: "ses_test",
    messageID: "msg_compaction",
    type: "compaction",
    auto: true,
  } as Part
}

function providers(): Provider[] {
  return [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-sonnet": {
          id: "claude-sonnet",
          name: "Claude Sonnet",
        },
      },
    } as Provider,
  ]
}
