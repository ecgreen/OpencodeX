import type { Part, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import type { MessageBundle } from "../src/renderer/src/lib/store"
import { defaultTranscriptExportOptions, normalizeTranscriptFilename, prepareSessionTranscriptExport } from "../src/renderer/src/lib/transcript-export"

describe("GUI functional workflows", () => {
  test("exports a transcript with the user's dialog options", () => {
    const defaults = defaultTranscriptExportOptions({
      session: session(),
      thinking: true,
      toolDetails: true,
      assistantMetadata: true,
    })
    const exportData = prepareSessionTranscriptExport({
      session: session(),
      messages: [assistantMessage()],
      providers: providers(),
      options: {
        ...defaults,
        filename: "release notes",
        thinking: false,
        toolDetails: false,
        assistantMetadata: false,
        openWithoutSaving: true,
      },
    })

    expect(defaults.filename).toBe("session-ses_func.md")
    expect(exportData.filename).toBe("release notes.md")
    expect(exportData.openWithoutSaving).toBe(true)
    expect(exportData.markdown).toContain("## Assistant\n")
    expect(exportData.markdown).toContain("Visible answer")
    expect(exportData.markdown).toContain("**Tool:**")
    expect(exportData.markdown).not.toContain("hidden chain")
    expect(exportData.markdown).not.toContain("**Input:**")
    expect(exportData.markdown).not.toContain("Claude Sonnet")
  })

  test("normalizes unsafe transcript filenames before download", () => {
    expect(normalizeTranscriptFilename("bad:name?.md", session())).toBe("bad-name-.md")
    expect(normalizeTranscriptFilename("  ", session())).toBe("session-ses_func.md")
    expect(normalizeTranscriptFilename("notes", session())).toBe("notes.md")
  })
})

function session(): Session {
  return {
    id: "ses_functional",
    title: "Functional session",
    directory: "C:\\Work\\OpencodeX",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
    cost: 0,
  } as Session
}

function assistantMessage(): MessageBundle {
  return {
    info: {
      id: "msg_assistant",
      sessionID: "ses_functional",
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
      {
        id: "prt_text",
        sessionID: "ses_functional",
        messageID: "msg_assistant",
        type: "text",
        text: "Visible answer",
      } as Part,
      {
        id: "prt_reasoning",
        sessionID: "ses_functional",
        messageID: "msg_assistant",
        type: "reasoning",
        text: "hidden chain",
      } as Part,
      {
        id: "prt_tool",
        sessionID: "ses_functional",
        messageID: "msg_assistant",
        type: "tool",
        tool: "bash",
        callID: "call_test",
        state: {
          status: "completed",
          input: { command: "echo ok" },
          output: "ok",
        },
      } as Part,
    ],
  } as MessageBundle
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
