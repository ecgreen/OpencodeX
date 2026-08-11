import { describe, expect, test } from "bun:test"
import { transcriptFilePath } from "../src/renderer/src/lib/transcript-file-links"

describe("transcript file path detection", () => {
  test("accepts repo-relative paths", () => {
    expect(transcriptFilePath("docs/superpowers/specs/2026-08-10-foo-design.md"))
      .toBe("docs/superpowers/specs/2026-08-10-foo-design.md")
    expect(transcriptFilePath("packages/gui/src/main/index.ts")).toBe("packages/gui/src/main/index.ts")
  })

  test("accepts and normalizes backslash and ./ paths", () => {
    expect(transcriptFilePath("packages\\gui\\src\\main\\index.ts")).toBe("packages/gui/src/main/index.ts")
    expect(transcriptFilePath("./docs/README.md")).toBe("docs/README.md")
  })

  test("strips :line and :line:col suffixes", () => {
    expect(transcriptFilePath("src/app.ts:42")).toBe("src/app.ts")
    expect(transcriptFilePath("src/app.ts:42:7")).toBe("src/app.ts")
  })

  test("accepts absolute and dotfile paths", () => {
    expect(transcriptFilePath("C:\\Work\\OpencodeX\\package.json")).toBe("C:/Work/OpencodeX/package.json")
    expect(transcriptFilePath("config/.env")).toBe("config/.env")
  })

  test("rejects URLs and pseudo-URLs", () => {
    expect(transcriptFilePath("https://example.com/a/b.md")).toBeUndefined()
    expect(transcriptFilePath("opencodex://files")).toBeUndefined()
    expect(transcriptFilePath("file://etc/hosts")).toBeUndefined()
  })

  test("rejects non-path inline code", () => {
    expect(transcriptFilePath("const a = 1/2")).toBeUndefined() // whitespace
    expect(transcriptFilePath("package.json")).toBeUndefined() // no separator
    expect(transcriptFilePath("a/b")).toBeUndefined() // no extension
    expect(transcriptFilePath("foo/bar/")).toBeUndefined() // directory
    expect(transcriptFilePath("")).toBeUndefined()
  })

  test("rejects globs and version-ish strings", () => {
    expect(transcriptFilePath("src/**/*.ts")).toBeUndefined() // glob
    expect(transcriptFilePath("1/2.5")).toBeUndefined() // version-ish, extension starts with digit
    expect(transcriptFilePath("localhost:3000/api/v2.0")).toBeUndefined() // version-ish, extension starts with digit
  })
})
