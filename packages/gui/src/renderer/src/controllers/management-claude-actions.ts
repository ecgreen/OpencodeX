import type { OpencodeXTerminalSession } from "@opencode-ai/sdk/v2/client"
import type { Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { compactPath, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/session-api"
import { terminalSessionRoute, type createClaudeTerminalController } from "./claude-terminal-controller"
import { createTerminalSession } from "../lib/store-opencodex-actions"
import type { createDialogController } from "./dialog-controller"
import type { createNavigationController } from "./navigation-controller"

export function createClaudeManagementActions(input: {
  client: Accessor<GuiClient | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  navigation: ReturnType<typeof createNavigationController>
  dialogs: ReturnType<typeof createDialogController>
  claudeTerminals: ReturnType<typeof createClaudeTerminalController>
  refresh: () => Promise<void>
  alert: (message: string) => void
  succeed?: (message: string) => void
}) {
  async function renameClaudeSession(record: OpencodeXTerminalSession) {
    const client = input.client()
    if (!client) return
    const value = await input.dialogs.askText({
      title: "Rename Claude Code Session",
      message: "This changes only the OpencodeX display name.",
      value: record.title,
    })
    if (value === undefined) return
    await client.client.opencodex.terminalSession.update(
      {
        terminalSessionID: record.id,
        expectedTimeUpdated: Number(record.timeUpdated),
        title: value.trim() || "Claude Code",
      },
      { throwOnError: true },
    )
    await input.refresh()
  }

  async function moveClaudeSession(record: OpencodeXTerminalSession) {
    const client = input.client()
    if (!client) return
    const projectID = await input.dialogs.askChoice({
      title: "Move Claude Code Session",
      message: "Project organization changes; the original working directory stays fixed.",
      options: [
        { value: "__none__", title: "No project", description: "Keep the session in the global catalog" },
        ...(input.snapshot()?.projects ?? []).map((project) => ({
          value: project.id,
          title: title(project.name ?? project.project.name),
          description: project.folders.map((folder) => compactPath(folder.path)).join(", "),
        })),
      ],
    })
    if (projectID === undefined) return
    await updateTerminalSessionProject(client, record, projectID === "__none__" ? null : projectID)
    await input.refresh()
  }

  async function removeClaudeSession(record: OpencodeXTerminalSession) {
    const client = input.client()
    if (!client) return
    if (
      !(await input.dialogs.confirm({
        title: "Remove Claude Code Session",
        message: `Remove “${record.title}” from OpencodeX? The local Claude conversation is preserved and remains available through Claude Code’s own resume tools.`,
        confirm: "Remove",
      }))
    )
      return
    await input.claudeTerminals.stop(record)
    await client.client.opencodex.terminalSession.delete(
      { terminalSessionID: record.id },
      { throwOnError: true },
    )
    await input.refresh()
    input.navigation.setRoute({ name: "sessions" })
  }

  /**
   * Starts a Claude Code session in a project folder. The record is created
   * first and the terminal attaches when the route opens, which is the same
   * order the driver uses when it adopts a session it did not start.
   */
  async function launchClaudeSession(projectID: string, directory: string) {
    const client = input.client()
    if (!client) return
    const installationID = input.claudeTerminals.installationID()
    if (!installationID) {
      return input.alert("Claude Code sessions need the OpencodeX desktop app, which supplies the installation this machine runs under.")
    }
    const created = await createTerminalSession(client, { projectID, directory, installationID })
    const record = created.data
    if (!record) return input.alert("Claude Code did not return a session.")
    await input.refresh()
    input.succeed?.(`Launched Claude Code in ${compactPath(directory)}.`)
    input.navigation.setRoute(terminalSessionRoute(record, record.id))
  }

  return { renameClaudeSession, moveClaudeSession, removeClaudeSession, launchClaudeSession }
}

async function updateTerminalSessionProject(
  client: GuiClient,
  record: OpencodeXTerminalSession,
  projectID: string | null,
) {
  const response = await fetch(
    new URL(`/experimental/opencodex/terminal-session/${encodeURIComponent(record.id)}`, client.url),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": client.directory,
        ...(client.authHeader ? { authorization: client.authHeader } : {}),
      },
      body: JSON.stringify({ expectedTimeUpdated: Number(record.timeUpdated), projectID }),
    },
  )
  if (response.ok) return
  throw new Error(`Could not move the terminal session (${response.status}).`)
}
