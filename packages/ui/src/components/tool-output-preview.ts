import { utf8PrefixLength } from "./code-highlight"

export const TOOL_OUTPUT_PREVIEW_LIMITS = {
  collapsed: { maxLines: 200, maxBytes: 64 * 1024 },
  expanded: { maxLines: 2000, maxBytes: 256 * 1024 },
} as const

export type ToolOutputPreviewLimits = {
  maxLines: number
  maxBytes: number
}

export function previewToolOutput(output: string, limits: ToolOutputPreviewLimits = TOOL_OUTPUT_PREVIEW_LIMITS.collapsed) {
  const byteEnd = utf8PrefixLength(output, Math.max(0, Math.floor(limits.maxBytes)))
  const end = lineLimit(output, Math.max(0, Math.floor(limits.maxLines)), byteEnd)
  return {
    text: end === output.length ? output : output.slice(0, end),
    truncated: end < output.length,
  }
}

function lineLimit(output: string, maxLines: number, end: number) {
  if (maxLines < 1) return 0
  let lines = 1
  for (let index = 0; index < end; index++) {
    if (output.charCodeAt(index) !== 10) continue
    if (lines < maxLines) {
      lines++
      continue
    }
    return output.charCodeAt(index - 1) === 13 ? index - 1 : index
  }
  return end
}
