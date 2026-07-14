import type { Accessor, Setter } from "solid-js"
import type { WorkbenchDiagnostic } from "../lib/store"
import {
  addWorkbenchArtifact,
  workbenchDiffPrompt,
  workbenchUnsavedBufferDiff,
  type WorkbenchArtifact,
  type WorkbenchFileBuffer,
} from "../lib/workbench"
import type { FileContent } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchPageProps } from "./workbench-page-types"

export function createWorkbenchContextController(input: {
  props: WorkbenchPageProps
  path: Accessor<string>
  buffer: Accessor<WorkbenchFileBuffer<FileContent> | undefined>
  selection: Accessor<string>
  diagnosticsCommand: Accessor<string>
  setArtifacts: Setter<WorkbenchArtifact[]>
  setNotice: (value: string) => void
}) {
  function prompt(text: string) {
    input.props.sendToComposer?.(text)
    input.setNotice("Sent context to the composer.")
  }

  function promptFile(kind: "file" | "selection") {
    if (!input.path()) return
    if (kind === "file") {
      prompt(`Use ${input.path()} as context. Review the file and suggest the next change.`)
      return
    }
    if (!input.selection().trim()) {
      input.setNotice("Select text in the editor before sending a selection.")
      return
    }
    prompt([`Use this selection from ${input.path()} as context:`, "", "```", input.selection(), "```"].join("\n"))
  }

  function saveFileArtifact(kind: "file" | "selection") {
    const path = input.path()
    const text = kind === "selection" ? input.selection() : input.buffer()?.content
    if (!path || !text?.trim()) {
      input.setNotice(kind === "selection" ? "Select text in the editor before saving a selection artifact." : "Open a text file before saving an artifact.")
      return
    }
    input.setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "note",
      title: kind === "selection" ? `Selection - ${path}` : `File - ${path}`,
      text: [
        kind === "selection" ? `Selection from ${path}` : `File context from ${path}`,
        "",
        "```",
        text.length > 20_000 ? `${text.slice(0, 20_000)}\n\n[Content truncated]` : text,
        "```",
      ].join("\n"),
    }))
    input.setNotice("Saved artifact.")
  }

  function promptUnsavedDiff() {
    const diff = workbenchUnsavedBufferDiff(input.buffer())
    if (!diff) {
      input.setNotice("Edit the file before asking about unsaved changes.")
      return
    }
    prompt(workbenchDiffPrompt({ ...diff, status: "unsaved" }))
  }

  function promptDiagnosticFix(item: WorkbenchDiagnostic) {
    const location = item.path ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}` : "Project"
    prompt([
      `Fix this ${item.severity} reported by Workbench diagnostics.`,
      "",
      `Location: ${location}`,
      `Message: ${item.message}`,
      input.diagnosticsCommand() ? `Command: ${input.diagnosticsCommand()}` : "",
      "",
      "Suggest the smallest safe patch and explain why it fixes the issue.",
    ].filter(Boolean).join("\n"))
  }

  function saveUnsavedDiffArtifact() {
    const diff = workbenchUnsavedBufferDiff(input.buffer())
    if (!diff) {
      input.setNotice("Edit the file before saving an unsaved diff artifact.")
      return
    }
    input.setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "note",
      title: `Unsaved diff - ${diff.file}`,
      text: workbenchDiffPrompt({ ...diff, status: "unsaved" }),
    }))
    input.setNotice("Saved unsaved diff artifact.")
  }

  function promptArtifact(artifact: WorkbenchArtifact) {
    prompt([
      `Use this Workbench artifact as context: ${artifact.title}`,
      "",
      artifact.text ?? (artifact.url?.startsWith("http") ? artifact.url : "[Screenshot artifact is previewed in the Workbench.]"),
    ].join("\n").trim())
  }

  return { prompt, promptFile, saveFileArtifact, promptUnsavedDiff, promptDiagnosticFix, saveUnsavedDiffArtifact, promptArtifact }
}
