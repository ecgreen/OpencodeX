/**
 * Attachment handling for the swarm orchestrator turn.
 *
 * The Claude-orchestrator path flattens a user message to text before handing
 * it to the CLI:
 *
 *     const text = last.parts
 *       .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []))
 *       .join("\n")
 *
 * Every non-text part is discarded there, and `runTurn` accepts only `text`, so
 * an image attached in a client never reaches the model. It persists fine and
 * the UI shows it attached — it simply vanishes on the way to the orchestrator.
 * Confirmed against a live session: images sent on non-swarm models arrived,
 * three sent on a swarm did not.
 *
 * The CLI takes a prompt *string*, not structured content, so inline base64
 * cannot be passed through. Instead materialise each attachment to a file and
 * name the paths in the prompt; the orchestrator reads them with its own Read
 * tool, which handles images.
 *
 * This module is the pure half: decide filenames and the prompt annotation.
 * No fs, no Effect — so it is unit-testable directly.
 */

export interface AttachmentPart {
  type: string
  mime?: string
  url?: string
  filename?: string
}

export interface PreparedAttachment {
  /** Basename to write, already made safe for the filesystem. */
  filename: string
  mime: string
  /** Decoded bytes, base64 in the source data URL. */
  base64: string
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
}

export function extensionFor(mime: string, filename?: string): string {
  const fromName = filename?.includes(".") ? filename.split(".").pop() : undefined
  if (fromName && /^[a-z0-9]{1,5}$/i.test(fromName)) return fromName.toLowerCase()
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? "bin"
}

/**
 * Strip anything that could escape the attachment directory or confuse a
 * shell/path: an attacker-supplied `filename` arrives straight from a client.
 */
export function safeBasename(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "")
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
}

/** Parse a `data:<mime>;base64,<payload>` URL. Returns null for anything else. */
export function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url)
  if (!match) return null
  const [, mime, base64] = match
  if (!mime || !base64) return null
  return { mime, base64 }
}

/**
 * Collect the file parts of a message into writable attachments.
 *
 * Parts whose url is not an inline data URL are skipped: a remote or already-
 * on-disk url needs no materialising, and guessing at fetching one here would
 * add a network dependency to a prompt path.
 */
export function prepareAttachments(parts: readonly AttachmentPart[] | undefined): PreparedAttachment[] {
  const out: PreparedAttachment[] = []
  let index = 0
  for (const part of parts ?? []) {
    if (part.type !== "file" || !part.url) continue
    const parsed = parseDataUrl(part.url)
    if (!parsed) continue
    index += 1
    const mime = part.mime || parsed.mime
    const fallback = `attachment-${index}.${extensionFor(mime, part.filename)}`
    out.push({ filename: safeBasename(part.filename ?? fallback, fallback), mime, base64: parsed.base64 })
  }
  return out
}

/**
 * Append the attachment paths to the prompt so the orchestrator knows they
 * exist and can read them. Returns the text unchanged when there is nothing to
 * add, so non-attachment turns are byte-identical to before.
 */
export function withAttachmentNote(text: string, paths: readonly string[]): string {
  if (paths.length === 0) return text
  const lines = paths.map((path) => `- ${path}`).join("\n")
  const note = `The user attached ${paths.length === 1 ? "a file" : `${paths.length} files`}. Read ${
    paths.length === 1 ? "it" : "them"
  } from disk:\n${lines}`
  return text.trim().length > 0 ? `${text}\n\n${note}` : note
}
