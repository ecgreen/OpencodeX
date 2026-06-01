import { describe, expect, test } from "bun:test"
import {
  DRAFT_MAX_CHARS,
  DRAFT_MAX_ENTRIES,
  isPromptInfo,
  isPromptPart,
  parseDrafts,
  type DraftsFile,
} from "../../../../src/cli/cmd/tui/component/prompt/drafts"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

const longInput = (length: number) => "a".repeat(length)

describe("prompt drafts validation", () => {
  test("DRAFT_MAX_CHARS matches documented cap", () => {
    expect(DRAFT_MAX_CHARS).toBe(50_000)
  })

  test("DRAFT_MAX_ENTRIES matches documented cap", () => {
    expect(DRAFT_MAX_ENTRIES).toBe(200)
  })

  test("isPromptInfo accepts a minimal entry", () => {
    expect(isPromptInfo({ input: "hello", parts: [] })).toBe(true)
  })

  test("isPromptInfo rejects non-string input", () => {
    expect(isPromptInfo({ input: 12, parts: [] })).toBe(false)
  })

  test("isPromptInfo rejects missing parts", () => {
    expect(isPromptInfo({ input: "hello" })).toBe(false)
  })

  test("isPromptInfo rejects non-array parts", () => {
    expect(isPromptInfo({ input: "hello", parts: "nope" })).toBe(false)
  })

  test("isPromptInfo rejects entries above the size cap", () => {
    expect(isPromptInfo({ input: longInput(DRAFT_MAX_CHARS + 1), parts: [] })).toBe(false)
  })

  test("isPromptInfo accepts entries at the size cap", () => {
    expect(isPromptInfo({ input: longInput(DRAFT_MAX_CHARS), parts: [] })).toBe(true)
  })

  test("isPromptInfo rejects parts without a type", () => {
    expect(isPromptInfo({ input: "hello", parts: [{ foo: "bar" }] })).toBe(false)
  })

  test("isPromptInfo rejects parts with unknown type", () => {
    expect(isPromptInfo({ input: "hello", parts: [{ type: "bogus" }] })).toBe(false)
  })

  test("isPromptInfo accepts text, file, and agent parts", () => {
    const valid: PromptInfo = {
      input: "describe this",
      parts: [
        { type: "text", text: "raw" },
        { type: "file", mime: "image/png", filename: "a.png", url: "data:image/png;base64,AAA" },
        {
          type: "agent",
          name: "build",
          source: { value: "@build", start: 0, end: 6 },
        },
      ],
    }
    expect(isPromptInfo(valid)).toBe(true)
  })

  test("isPromptPart recognises known part types", () => {
    expect(isPromptPart({ type: "text" })).toBe(true)
    expect(isPromptPart({ type: "file" })).toBe(true)
    expect(isPromptPart({ type: "agent" })).toBe(true)
  })

  test("isPromptPart rejects other shapes", () => {
    expect(isPromptPart(null)).toBe(false)
    expect(isPromptPart(undefined)).toBe(false)
    expect(isPromptPart("text")).toBe(false)
    expect(isPromptPart({ type: "subtask" })).toBe(false)
  })
})

describe("parseDrafts", () => {
  test("returns empty for empty input", () => {
    expect(parseDrafts("")).toEqual({})
  })

  test("returns empty for whitespace-only input", () => {
    expect(parseDrafts("   \n\t  ")).toEqual({})
  })

  test("returns empty for invalid JSON", () => {
    expect(parseDrafts("{ not valid json")).toEqual({})
  })

  test("returns empty for non-object JSON", () => {
    expect(parseDrafts("[]")).toEqual({})
    expect(parseDrafts("42")).toEqual({})
    expect(parseDrafts("null")).toEqual({})
  })

  test("parses a single valid entry", () => {
    const file = JSON.stringify({ home: { input: "hello", parts: [] } })
    const parsed = parseDrafts(file)
    expect(parsed.home?.input).toBe("hello")
    expect(parsed.home?.parts).toEqual([])
  })

  test("drops invalid entries but keeps valid ones", () => {
    const file = JSON.stringify({
      good: { input: "hello", parts: [] },
      oversized: { input: longInput(DRAFT_MAX_CHARS + 5), parts: [] },
      wrongShape: { input: 12, parts: [] },
      bogusParts: { input: "x", parts: [{ type: "mystery" }] },
    })
    const parsed: DraftsFile = parseDrafts(file)
    expect(Object.keys(parsed).sort()).toEqual(["good"])
    expect(parsed.good?.input).toBe("hello")
  })

  test("preserves shell mode", () => {
    const file = JSON.stringify({ home: { input: "ls", parts: [], mode: "shell" } })
    expect(parseDrafts(file).home?.mode).toBe("shell")
  })

  test("preserves normal mode", () => {
    const file = JSON.stringify({ home: { input: "ls", parts: [], mode: "normal" } })
    expect(parseDrafts(file).home?.mode).toBe("normal")
  })

  test("drops unknown mode values", () => {
    const file = JSON.stringify({ home: { input: "ls", parts: [], mode: "bogus" } })
    expect(parseDrafts(file).home?.mode).toBeUndefined()
  })
})
