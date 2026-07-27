import { describe, expect, test } from "bun:test"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput } from "./tool-output-preview"

describe("tool output preview", () => {
  test("does not change content within the selected budget", () => {
    expect(previewToolOutput("one\ntwo")).toEqual({ text: "one\ntwo", truncated: false })
  })

  test("caps collapsed and expanded previews by line count", () => {
    const output = Array.from({ length: 2001 }, (_, index) => String(index)).join("\n")
    const collapsed = previewToolOutput(output)
    const expanded = previewToolOutput(output, TOOL_OUTPUT_PREVIEW_LIMITS.expanded)

    expect(collapsed.text.split("\n")).toHaveLength(200)
    expect(collapsed.truncated).toBe(true)
    expect(expanded.text.split("\n")).toHaveLength(2000)
    expect(expanded.truncated).toBe(true)
  })

  test("uses UTF-8 byte budgets and preserves whole multibyte characters", () => {
    const exact = "😀".repeat(16384)
    expect(previewToolOutput(exact)).toEqual({ text: exact, truncated: false })
    expect(previewToolOutput(`${exact}😀`)).toEqual({ text: exact, truncated: true })

    const expanded = "é".repeat(131072)
    expect(previewToolOutput(expanded, TOOL_OUTPUT_PREVIEW_LIMITS.expanded)).toEqual({
      text: expanded,
      truncated: false,
    })
    expect(previewToolOutput(`${expanded}é`, TOOL_OUTPUT_PREVIEW_LIMITS.expanded)).toEqual({
      text: expanded,
      truncated: true,
    })
  })

  test("enforces collapsed and expanded byte limits exactly", () => {
    const collapsed = "a".repeat(TOOL_OUTPUT_PREVIEW_LIMITS.collapsed.maxBytes)
    const expanded = "a".repeat(TOOL_OUTPUT_PREVIEW_LIMITS.expanded.maxBytes)

    expect(previewToolOutput(`${collapsed}b`)).toEqual({ text: collapsed, truncated: true })
    expect(previewToolOutput(`${expanded}b`, TOOL_OUTPUT_PREVIEW_LIMITS.expanded)).toEqual({
      text: expanded,
      truncated: true,
    })
  })

  test("reports truncation without changing the caller's full copy source", () => {
    const output = `${"line\n".repeat(TOOL_OUTPUT_PREVIEW_LIMITS.collapsed.maxLines)}tail`
    const preview = previewToolOutput(output)
    expect(preview.truncated).toBe(true)
    expect(preview.text).not.toContain("tail")
    expect(output.endsWith("tail")).toBe(true)
  })
})
