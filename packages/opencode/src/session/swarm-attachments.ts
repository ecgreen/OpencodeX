import type { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { ClaudeImage } from "@/opencodex/claude-transport"

const IMAGE_MIMES = new Set<ClaudeImage["source"]["media_type"]>(["image/jpeg", "image/png", "image/gif", "image/webp"])

export type SkippedAttachment = "not-inline" | "unsupported-media-type" | "invalid-base64"

/** Converts persisted image parts into blocks accepted natively by Claude. */
export function prepareImages(parts: readonly SessionLegacy.Part[] | undefined) {
  const skipped: SkippedAttachment[] = []
  const accepted = (parts ?? []).flatMap((part) => {
    if (part.type !== "file") return []
    if (part.mime.toLowerCase().startsWith("text/plain")) return []
    const parsed = parseDataUrl(part.url)
    if (!parsed) {
      skipped.push("not-inline")
      return []
    }
    if (parsed.mime === "text/plain") return []
    const mime = imageMime(parsed.mime)
    if (!mime) {
      skipped.push("unsupported-media-type")
      return []
    }
    if (!isBase64(parsed.base64)) {
      skipped.push("invalid-base64")
      return []
    }
    return [
      {
        image: {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mime, data: parsed.base64 },
        },
        filename: part.filename?.trim().replace(/\s+/g, " ").slice(0, 80),
      },
    ]
  })
  return {
    images: accepted.map((item) => item.image),
    title: accepted[0]?.filename || (accepted.length > 0 ? "Image attachment" : undefined),
    skipped,
  }
}

/** Accepts data URL parameters used by ACP and third-party clients. */
export function parseDataUrl(url: string): { mime: string; base64: string } | undefined {
  const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/is.exec(url)
  if (!match?.[1]) return undefined
  return { mime: match[1].toLowerCase(), base64: match[2] ?? "" }
}

function imageMime(mime: string): ClaudeImage["source"]["media_type"] | undefined {
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime
  return IMAGE_MIMES.has(normalized as ClaudeImage["source"]["media_type"])
    ? (normalized as ClaudeImage["source"]["media_type"])
    : undefined
}

function isBase64(value: string) {
  return value.length > 0 && value.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}
