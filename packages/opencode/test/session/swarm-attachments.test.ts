import { describe, expect, test } from "bun:test"
import {
  extensionFor,
  parseDataUrl,
  prepareAttachments,
  safeBasename,
  withAttachmentNote,
} from "@/session/swarm-attachments"

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="

describe("parseDataUrl", () => {
  test("parses a base64 data url", () => {
    expect(parseDataUrl(jpeg)).toEqual({ mime: "image/jpeg", base64: "/9j/4AAQSkZJRg==" })
  })

  test("rejects non-data and non-base64 urls", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull()
    expect(parseDataUrl("data:image/png,notbase64")).toBeNull()
    expect(parseDataUrl("")).toBeNull()
  })
})

describe("safeBasename", () => {
  test("strips directory traversal", () => {
    expect(safeBasename("../../etc/passwd", "fallback.bin")).toBe("passwd")
    expect(safeBasename("/absolute/path/x.png", "fallback.bin")).toBe("x.png")
  })

  test("neutralises characters that could confuse a path or shell", () => {
    expect(safeBasename("a b;rm -rf.png", "fallback.bin")).toBe("a_b_rm_-rf.png")
  })

  test("falls back when nothing usable survives", () => {
    expect(safeBasename("...", "fallback.bin")).toBe("fallback.bin")
    expect(safeBasename("", "fallback.bin")).toBe("fallback.bin")
  })
})

describe("extensionFor", () => {
  test("prefers a sane extension from the filename", () => {
    expect(extensionFor("image/jpeg", "shot.PNG")).toBe("png")
  })

  test("falls back to the mime type, then to bin", () => {
    expect(extensionFor("image/jpeg", undefined)).toBe("jpg")
    expect(extensionFor("application/octet-stream", undefined)).toBe("bin")
  })
})

describe("prepareAttachments", () => {
  test("collects inline file parts", () => {
    const out = prepareAttachments([
      { type: "text", url: undefined },
      { type: "file", mime: "image/jpeg", url: jpeg, filename: "screenshot.jpg" },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.filename).toBe("screenshot.jpg")
    expect(out[0]!.mime).toBe("image/jpeg")
  })

  test("skips remote urls rather than fetching them on the prompt path", () => {
    expect(prepareAttachments([{ type: "file", url: "https://example.com/a.png", mime: "image/png" }])).toEqual([])
  })

  test("names unnamed attachments predictably", () => {
    const out = prepareAttachments([
      { type: "file", mime: "image/png", url: "data:image/png;base64,AAA=" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,BBB=" },
    ])
    expect(out.map((a) => a.filename)).toEqual(["attachment-1.png", "attachment-2.png"])
  })

  test("tolerates an absent parts list", () => {
    expect(prepareAttachments(undefined)).toEqual([])
  })
})

describe("withAttachmentNote", () => {
  // The whole point: non-attachment turns must be byte-identical to before.
  test("returns the text untouched when there are no attachments", () => {
    expect(withAttachmentNote("hello", [])).toBe("hello")
  })

  test("names the paths so the orchestrator can read them", () => {
    const out = withAttachmentNote("look at this", ["/tmp/a/shot.jpg"])
    expect(out).toContain("look at this")
    expect(out).toContain("/tmp/a/shot.jpg")
    expect(out).toContain("attached a file")
  })

  test("pluralises for multiple attachments", () => {
    const out = withAttachmentNote("", ["/tmp/a.jpg", "/tmp/b.jpg"])
    expect(out).toContain("attached 2 files")
    expect(out).toContain("/tmp/a.jpg")
    expect(out).toContain("/tmp/b.jpg")
  })

  test("works when the user sent only an image with no text", () => {
    const out = withAttachmentNote("", ["/tmp/a.jpg"])
    expect(out.startsWith("The user attached")).toBe(true)
  })
})
