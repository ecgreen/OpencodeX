import { describe, expect, test } from "bun:test"
import type { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { parseDataUrl, prepareImages } from "@/session/swarm-attachments"

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
const file = (input: { mime: string; url: string; filename?: string }) =>
  ({ type: "file", ...input }) as SessionLegacy.Part

describe("parseDataUrl", () => {
  test("accepts parameters before the base64 marker", () => {
    expect(parseDataUrl("data:image/png;charset=utf-8;base64,AAA=")).toEqual({ mime: "image/png", base64: "AAA=" })
  })

  test("rejects remote and non-base64 urls", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeUndefined()
    expect(parseDataUrl("data:image/png,notbase64")).toBeUndefined()
  })

  test("rejects ambiguous parameter runs without pathological backtracking", () => {
    expect(parseDataUrl(`data:image/png${";".repeat(1_000)}x`)).toBeUndefined()
  })
})

describe("prepareImages", () => {
  test("creates native Claude image blocks", () => {
    expect(prepareImages([file({ mime: "image/jpeg", url: jpeg, filename: "screenshot.jpg" })])).toEqual({
      hasImages: true,
      images: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQSkZJRg==" },
        },
      ],
      title: "screenshot.jpg",
      skipped: [],
    })
  })

  test("keeps same-named images as distinct content blocks", () => {
    const prepared = prepareImages([
      file({ mime: "image/png", url: "data:image/png;base64,AAA=", filename: "clipboard" }),
      file({ mime: "image/png", url: "data:image/png;base64,BBB=", filename: "clipboard" }),
    ])
    expect(prepared.images.map((image) => image.source.data)).toEqual(["AAA=", "BBB="])
  })

  test("normalizes the common image/jpg alias for the SDK", () => {
    const prepared = prepareImages([file({ mime: "image/jpg", url: "data:image/jpg;base64,AAA=" })])
    expect(prepared.images[0]?.source.media_type).toBe("image/jpeg")
  })

  test("reports unsupported attachments instead of silently dropping them", () => {
    expect(
      prepareImages([
        file({ mime: "application/pdf", url: "data:application/pdf;base64,AAA=" }),
        file({ mime: "image/png", url: "https://example.com/a.png" }),
        file({ mime: "image/png", url: "data:image/png,notbase64" }),
        file({ mime: "image/png", url: "data:image/png;base64,%%%" }),
      ]).skipped,
    ).toEqual(["unsupported-media-type", "not-an-attachment", "malformed-data-url", "invalid-base64"])
  })

  test("uses the normalized part mime and does not bypass image normalization", () => {
    expect(
      prepareImages([file({ mime: "image/jpeg", url: "data:image/png;base64,AAA=" })]).images[0]?.source.media_type,
    ).toBe("image/jpeg")
    expect(
      prepareImages([file({ mime: "application/octet-stream", url: "data:image/png;base64,AAA=" })]).skipped,
    ).toEqual(["unsupported-media-type"])
    expect(prepareImages([file({ mime: "IMAGE/PNG", url: "data:image/png;base64,AAA=" })]).skipped).toEqual([
      "unsupported-media-type",
    ])
  })

  test("uses a stable title for an unnamed image-only message", () => {
    expect(prepareImages([file({ mime: "image/jpeg", url: jpeg })]).title).toBe("Image attachment")
  })

  test("keeps an untrusted filename on one bounded title line", () => {
    const title = prepareImages([file({ mime: "image/jpeg", url: jpeg, filename: "  first\nsecond.jpg  " })]).title
    expect(title).toBe("first second.jpg")
  })

  test("does not duplicate text attachments", () => {
    expect(
      prepareImages([
        file({ mime: "text/plain", url: "data:text/plain;base64,SGk=" }),
        file({ mime: "text/plain", url: "file:///tmp/note.txt" }),
      ]),
    ).toEqual({
      hasImages: false,
      images: [],
      skipped: [],
    })
  })
})
