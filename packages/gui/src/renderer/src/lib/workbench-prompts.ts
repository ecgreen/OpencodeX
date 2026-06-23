export function workbenchPromptTarget(input: {
  sessionID?: string
  projectID?: string
  projectDirectory?: string
  fallbackDirectory?: string
}) {
  if (input.sessionID) return { name: "session" as const, sessionID: input.sessionID }
  return {
    name: "new-session" as const,
    projectID: input.projectID,
    directory: input.projectDirectory ?? input.fallbackDirectory,
  }
}

export function workbenchDiffPrompt(input: {
  file?: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
}) {
  const file = input.file?.trim()
  const summary = [
    input.status ? `status: ${input.status}` : "",
    typeof input.additions === "number" ? `+${input.additions}` : "",
    typeof input.deletions === "number" ? `-${input.deletions}` : "",
  ].filter(Boolean).join(", ")
  const header = file
    ? `Review the Git diff for ${file}${summary ? ` (${summary})` : ""}.`
    : "Review the selected Git diff."
  const patch = input.patch?.trim()
  if (!patch) return `${header} Call out risks, missing tests, and whether I should edit, stage, or discard it.`
  const body = patch.length > 12_000 ? `${patch.slice(0, 12_000)}\n\n[Diff truncated]` : patch
  return [
    header,
    "Call out risks, missing tests, and whether I should edit, stage, or discard it.",
    "",
    "```diff",
    body,
    "```",
  ].join("\n")
}
