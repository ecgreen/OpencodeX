import type { FileContent } from "@opencode-ai/sdk/v2/client"

export const WORKBENCH_EDITABLE_FILE_BYTES = 750 * 1024
export const WORKBENCH_PREVIEW_FILE_BYTES = 2 * 1024 * 1024
export const WORKBENCH_PATCH_BYTES = 2 * 1024 * 1024

export type WorkbenchFileMode = "editable" | "preview" | "metadata"

export type WorkbenchFileRead = {
  content: FileContent
  bytes: number
  mode: WorkbenchFileMode
}

export function utf8ByteLength(value: string) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

export function boundedWorkbenchFile(content: FileContent): WorkbenchFileRead {
  const bytes = content.bytes ?? (content.encoding === "base64" ? base64DecodedBytes(content.content) : utf8ByteLength(content.content))
  const mode = content.truncated || bytes > WORKBENCH_PREVIEW_FILE_BYTES
    ? "metadata" as const
    : content.type === "text" && bytes <= WORKBENCH_EDITABLE_FILE_BYTES
      ? "editable" as const
      : "preview" as const
  return {
    content: {
      type: content.type,
      content: mode === "metadata" ? "" : content.content,
      ...(content.encoding ? { encoding: content.encoding } : {}),
      ...(content.mimeType ? { mimeType: content.mimeType } : {}),
      ...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
      ...(content.truncated !== undefined ? { truncated: content.truncated } : {}),
    },
    bytes,
    mode,
  }
}

function base64DecodedBytes(value: string) {
  const length = value.replace(/\s/g, "").length
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor(length * 3 / 4) - padding)
}
