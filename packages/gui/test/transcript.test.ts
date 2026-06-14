import type { Part, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import type { MessageBundle } from "../src/renderer/src/lib/store"
import { formatSessionTranscript } from "../src/renderer/src/lib/transcript"

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
    expect(transcript).toContain("\"command\": \"echo ok\"")
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
    parts: [
      textPart("Visible answer"),
      reasoningPart("hidden chain"),
      toolPart(),
    ],
  } as MessageBundle
}

function textPart(text: string): Part {
  return {
    id: "prt_text",
    sessionID: "ses_test",
    messageID: "msg_assistant",
    type: "text",
    text,
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
