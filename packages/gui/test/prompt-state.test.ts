import { describe, expect, test } from "bun:test"
import type { Command } from "@opencode-ai/sdk/v2/client"
import {
  PROMPT_DRAFT_MAX_CHARS,
  PROMPT_DRAFT_MAX_ENTRIES,
  PROMPT_STASH_MAX_ENTRIES,
  emptyPrompt,
  mergePromptDraft,
  normalizePromptInfo,
  parsePromptDrafts,
  parsePromptStash,
  nextPromptHistoryState,
  promptPartsForSubmit,
  pushPromptStash,
  serverCommandMatch,
  textPrompt,
} from "../src/renderer/src/lib/prompt-state"

describe("GUI prompt state helpers", () => {
  test("routes backend slash commands while ignoring skill commands", () => {
    const commands = [
      command("review", "command"),
      command("deploy", "mcp"),
      command("skill-only", "skill"),
    ]

    expect(serverCommandMatch("/review the staged files", commands)).toEqual({
      command: commands[0],
      arguments: "the staged files",
    })
    expect(serverCommandMatch("/deploy\nwith context", commands)).toEqual({
      command: commands[1],
      arguments: "with context",
    })
    expect(serverCommandMatch("/skill-only please", commands)).toBeUndefined()
    expect(serverCommandMatch("plain prompt", commands)).toBeUndefined()
  })

  test("keeps structured prompt parts for submission", () => {
    expect(promptPartsForSubmit(textPrompt("hello"))).toEqual([{ type: "text", text: "hello" }])
    expect(promptPartsForSubmit({
      input: "review this",
      parts: [{ type: "file", mime: "text/plain", filename: "a.txt", url: "data:text/plain,a" }],
    })).toEqual([
      { type: "text", text: "review this" },
      { type: "file", mime: "text/plain", filename: "a.txt", url: "data:text/plain,a" },
    ])
    expect(promptPartsForSubmit({
      input: "review this",
      parts: [{ type: "text", text: "review this" }, { type: "agent", name: "build" }],
    })).toEqual([{ type: "text", text: "review this" }, { type: "agent", name: "build" }])
    expect(promptPartsForSubmit({
      input: "",
      parts: [{ type: "agent", name: "review" }],
    })).toEqual([{ type: "agent", name: "review" }])
  })

  test("parses draft and stash storage with size limits", () => {
    expect(parsePromptDrafts(JSON.stringify({
      good: { input: "hello", parts: [{ type: "text", text: "hello" }] },
      bad: { input: "x", parts: [{ type: "unknown" }] },
    }))).toEqual({ good: { input: "hello", parts: [{ type: "text", text: "hello" }] } })

    const stash = pushPromptStash([], { input: "with file", parts: [{ type: "file", mime: "image/png", url: "data:image/png;base64,aa" }] }, 10)
    expect(parsePromptStash(stash.map((entry) => JSON.stringify(entry)).join("\n"))).toEqual(stash)
  })

  test("normalizes only valid prompt info and preserves supported modes", () => {
    expect(normalizePromptInfo({ input: "run it", mode: "shell", parts: [{ type: "text", text: "run it" }] })).toEqual({
      input: "run it",
      mode: "shell",
      parts: [{ type: "text", text: "run it" }],
    })
    expect(normalizePromptInfo({ input: "run it", mode: "unsupported", parts: [] })).toEqual({ input: "run it", parts: [] })
    expect(normalizePromptInfo({ input: "x".repeat(PROMPT_DRAFT_MAX_CHARS + 1), parts: [] })).toBeUndefined()
    expect(normalizePromptInfo({ input: "missing url", parts: [{ type: "file", mime: "text/plain" }] })).toBeUndefined()
    expect(normalizePromptInfo({ input: "bad agent", parts: [{ type: "agent", name: 1 }] })).toBeUndefined()
  })

  test("merges drafts immutably, caps stored entries, and rejects oversize drafts", () => {
    const part: { type: "agent"; name: string } = { type: "agent", name: "build" }
    const merged = mergePromptDraft({}, "session-1", { input: "hello", mode: "normal", parts: [part] })
    part.name = "review"

    expect(merged["session-1"]).toEqual({ input: "hello", mode: "normal", parts: [{ type: "agent", name: "build" }] })

    const capped = mergePromptDraft(
      Object.fromEntries(Array.from({ length: PROMPT_DRAFT_MAX_ENTRIES }, (_, index) => [`old-${index}`, textPrompt(`draft-${index}`)])),
      "new",
      textPrompt("fresh"),
    )

    expect(Object.keys(capped)).toHaveLength(PROMPT_DRAFT_MAX_ENTRIES)
    expect(capped["old-0"]).toBeUndefined()
    expect(capped.new).toEqual(textPrompt("fresh"))

    const drafts = { keep: textPrompt("safe") }
    expect(mergePromptDraft(drafts, "huge", { input: "x".repeat(PROMPT_DRAFT_MAX_CHARS + 1), parts: [] })).toBe(drafts)
  })

  test("stashes non-empty prompts with cloned parts and keeps the newest entries", () => {
    const entries = Array.from({ length: PROMPT_STASH_MAX_ENTRIES + 2 }, (_, index) => textPrompt(`prompt-${index}`))
      .reduce((stash, prompt, index) => pushPromptStash(stash, prompt, index), [])

    expect(entries).toHaveLength(PROMPT_STASH_MAX_ENTRIES)
    expect(entries[0]?.input).toBe("prompt-2")
    expect(pushPromptStash(entries, emptyPrompt(), 100)).toBe(entries)

    const part: { type: "file"; mime: string; url: string } = { type: "file", mime: "text/plain", url: "data:text/plain,hello" }
    const stash = pushPromptStash([], { input: "with file", parts: [part] }, 1)
    part.url = "data:text/plain,changed"

    expect(stash[0]).toEqual({
      input: "with file",
      parts: [{ type: "file", mime: "text/plain", url: "data:text/plain,hello" }],
      timestamp: 1,
    })
  })

  test("navigates prompt history back to an empty newest state", () => {
    const history = ["older", "latest"]

    const recalled = nextPromptHistoryState({
      history,
      offset: -1,
      historyIndex: -1,
      historyDraft: "",
      draftPrompt: "",
    })

    expect(recalled).toEqual({ historyIndex: 1, historyDraft: "", draftPrompt: "latest" })
    expect(nextPromptHistoryState({
      history,
      offset: 1,
      historyIndex: recalled?.historyIndex ?? -1,
      historyDraft: recalled?.historyDraft ?? "",
      draftPrompt: recalled?.draftPrompt ?? "",
    })).toEqual({ historyIndex: -1, historyDraft: "", draftPrompt: "" })
  })

  test("restores a distinct draft after prompt history navigation", () => {
    const recalled = nextPromptHistoryState({
      history: ["older", "latest"],
      offset: -1,
      historyIndex: -1,
      historyDraft: "",
      draftPrompt: "half written",
    })

    expect(recalled).toEqual({ historyIndex: 1, historyDraft: "half written", draftPrompt: "latest" })
    expect(nextPromptHistoryState({
      history: ["older", "latest"],
      offset: 1,
      historyIndex: recalled?.historyIndex ?? -1,
      historyDraft: recalled?.historyDraft ?? "",
      draftPrompt: recalled?.draftPrompt ?? "",
    })).toEqual({ historyIndex: -1, historyDraft: "", draftPrompt: "half written" })
  })

  test("clears newest history text when down is pressed after the history index is reset", () => {
    expect(nextPromptHistoryState({
      history: ["older", "latest"],
      offset: 1,
      historyIndex: -1,
      historyDraft: "",
      draftPrompt: "latest",
    })).toEqual({ historyIndex: -1, historyDraft: "", draftPrompt: "" })
  })
})

function command(name: string, source: Command["source"]): Command {
  return { name, source, template: "", hints: [] }
}
