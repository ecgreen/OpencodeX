import { describe, expect, test } from "bun:test"
import {
  CODE_HIGHLIGHT_MAX_BYTES,
  CODE_HIGHLIGHT_MAX_LINE_BYTES,
  canHighlightCode,
  utf8ByteLength,
} from "./code-highlight"

describe("code highlighting admission", () => {
  test("counts UTF-8 bytes without splitting multibyte characters", () => {
    expect(utf8ByteLength("aé😀")).toBe(7)
    expect(utf8ByteLength("\ud800")).toBe(3)
  })

  test("admits the longest line limit and rejects one multibyte character beyond it", () => {
    expect(utf8ByteLength("😀".repeat(2048))).toBe(CODE_HIGHLIGHT_MAX_LINE_BYTES)
    expect(canHighlightCode("😀".repeat(2048))).toBe(true)
    expect(canHighlightCode("😀".repeat(2049))).toBe(false)
  })

  test("applies the total limit in UTF-8 bytes across short lines", () => {
    const exact = `${"😀\n".repeat(26214)}aa`
    expect(utf8ByteLength(exact)).toBe(CODE_HIGHLIGHT_MAX_BYTES)
    expect(canHighlightCode(exact)).toBe(true)
    expect(canHighlightCode(`${exact}é`)).toBe(false)
  })
})
