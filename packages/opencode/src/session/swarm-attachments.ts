import type { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { ClaudeImage } from "@/opencodex/claude-transport"

const IMAGE_MIMES = new Set<ClaudeImage["source"]["media_type"]>(["image/jpeg", "image/png", "image/gif", "image/webp"])

export type SkippedAttachment =
  | "not-an-attachment"
  | "malformed-data-url"
  | "unsupported-media-type"
  | "invalid-base64"

/** Converts persisted image parts into blocks accepted natively by Claude. */
export function prepareImages(parts: readonly SessionLegacy.Part[] | undefined) {
  const skipped: SkippedAttachment[] = []
  const accepted = (parts ?? []).flatMap((part) => {
    if (part.type !== "file") return []
    if (part.mime.toLowerCase().startsWith("text/plain")) return []
    const parsed = parseDataUrl(part.url)
    if (!parsed) {
      skipped.push(part.url.toLowerCase().startsWith("data:") ? "malformed-data-url" : "not-an-attachment")
      return []
    }
    if (!part.mime.startsWith("image/")) {
      skipped.push("unsupported-media-type")
      return []
    }
    const mime = imageMime(part.mime.split(";", 1)[0]?.trim().toLowerCase() ?? "")
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
        filename: part.filename?.trim().replace(/\s+/g, " "),
      },
    ]
  })
  const first = accepted[0]
  if (!first) return { hasImages: false as const, images: [], skipped }
  return {
    hasImages: true as const,
    images: accepted.map((item) => item.image),
    title: first.filename || "Image attachment",
    skipped,
  }
}

/** Accepts data URL parameters used by ACP and third-party clients. */
export function parseDataUrl(url: string): { mime: string; base64: string } | undefined {
  if (!url.toLowerCase().startsWith("data:")) return undefined
  const comma = url.indexOf(",")
  if (comma === -1) return undefined
  const metadata = url.slice(5, comma).split(";")
  const mime = metadata.shift()?.trim()
  if (!mime || metadata.at(-1)?.toLowerCase() !== "base64") return undefined
  return { mime: mime.toLowerCase(), base64: url.slice(comma + 1) }
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
