import { Show, createMemo } from "solid-js"
import { CodeBlock } from "@opencode-ai/ui/code-block"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput, type ToolOutputPreviewLimits } from "@opencode-ai/ui/tool-output-preview"
import { COPY_FULL_LABEL, copyFullToolText } from "../lib/tool-display"
import { Button } from "./ui"

/*
 * Bounded text/code previews shared by tool bodies, diffs, and the permission
 * card. They live apart from session-tool-details so the diff module does not
 * import its own importer.
 */

export function ToolCodeBlock(props: { code: string; language?: string; class?: string }) {
  const preview = createMemo(() => previewToolOutput(props.code, TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  return <><CodeBlock class={props.class} language={props.language || "text"} code={preview().text} /><Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.code)}>{COPY_FULL_LABEL}</Button></Show></>
}

export function ToolPreviewText(props: { text: string; class?: string; limits?: ToolOutputPreviewLimits }) {
  const preview = createMemo(() => previewToolOutput(props.text, props.limits ?? TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  return <><pre class={props.class}>{preview().text}</pre><Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.text)}>{COPY_FULL_LABEL}</Button></Show></>
}
