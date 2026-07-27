import type { PromptPart } from "./store"

/** Presentation of the attachment chips above the composer input. */
export function partLabel(part: PromptPart) {
  if (part.type === "agent") return part.name
  if (part.type === "file") {
    if (part.filename) return fileBasename(part.filename)
    if (part.source?.type === "file") return fileBasename(part.source.path)
    if (part.source?.type === "resource") return fileBasename(part.source.uri)
    return "File"
  }
  return part.text.slice(0, 48) || "Text"
}

export function partIcon(part: PromptPart) {
  return part.type === "file" && part.mime === "application/x-directory" ? "folder" : "file"
}

export function partPreviewURL(part: PromptPart) {
  if (part.type !== "file" || !part.mime.startsWith("image/")) return undefined
  return part.url
}

export function partTitle(part: PromptPart) {
  if (part.type !== "file") return partLabel(part)
  return part.source?.type === "file" ? part.source.path : part.source?.type === "resource" ? part.source.uri : part.filename ?? "File"
}

/**
 * Every spelling the mention could have been typed as, so removing a chip also
 * removes the `@…` token that produced it.
 */
export function partRemovalLabels(part: PromptPart) {
  if (part.type === "agent") return [part.name]
  if (part.type !== "file") return []
  return [
    part.filename,
    part.filename ? fileBasename(part.filename) : undefined,
    part.source?.type === "file" ? part.source.path : undefined,
    part.source?.type === "file" ? fileBasename(part.source.path) : undefined,
    part.source?.type === "resource" ? part.source.uri : undefined,
    part.source?.type === "resource" ? fileBasename(part.source.uri) : undefined,
  ].filter((item, index, labels): item is string => Boolean(item) && labels.indexOf(item) === index)
}

export function promptWithoutPart(prompt: string, part: PromptPart) {
  return partRemovalLabels(part)
    .reduce((input, label) => input.replace(`@${label}`, ""), prompt)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function fileBasename(value: string) {
  return value.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).at(-1) ?? value
}
