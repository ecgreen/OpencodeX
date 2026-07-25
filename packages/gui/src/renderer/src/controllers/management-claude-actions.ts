import type { OpencodeXTerminalSession } from "@opencode-ai/sdk/v2/client"
import type { Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { compactPath, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import type { createClaudeTerminalController } from "./claude-terminal-controller"
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
}) {
  async function createClaudeSession(projectID?: string, directory?: string, options: { open?: boolean } = {}) {
    const client = input.client()
    if (!client) return
    if (!window.opencodex?.terminal || !window.opencodex.installationID) {
      input.alert("Claude Code sessions require OpencodeX Desktop.")
      return
    }
    // Gate on the CLI before asking for any details: a missing binary is an
    // installation problem, and it gets a guided install rather than a create
    // form that cannot succeed.
    let status = await input.claudeTerminals.checkCLI()
    if (!status.available) {
      const installed = await input.dialogs.askClaudeInstall()
      if (!installed) return
      status = await input.claudeTerminals.checkCLI()
      if (!status.available) {
        input.alert(status.message ?? "Claude Code is still not available. Restart OpencodeX after installing and try again.")
        return
      }
    }
    const projects = input.snapshot()?.projects ?? []
    const project = projects.find((item) => item.id === projectID)
    const value = await input.dialogs.askTerminalSession({
      title: "New Claude Code Session",
      message: "Claude Code owns authentication, permissions, and its transcript. OpencodeX keeps only this catalog entry.",
      directory: directory ?? project?.folders[0]?.path ?? client.directory,
      projectID,
      cliVersion: "version" in status ? status.version : undefined,
      projects: projects.map((item) => ({
        value: item.id,
        title: title(item.name ?? item.project.name),
        description: item.folders.map((folder) => compactPath(folder.path)).join(", "),
      })),
    })
    if (!value) return
    try {
      const installationID = await window.opencodex.installationID()
      const result = await client.client.opencodex.terminalSession.create(
        {
          opencodeXTerminalSessionCreateInput: {
            title: value.title,
            projectID: value.projectID,
            directory: value.directory,
            installationID,
          },
        },
        { throwOnError: true },
      )
      const record = result.data
      if (!record) throw new Error("The terminal session was created without a catalog record.")
      await input.refresh()
      if (options.open !== false) input.navigation.setRoute({ name: "terminal-session", terminalSessionID: record.id })
      return record
    } catch (error) {
      input.alert(
        error instanceof Error && error.message
          ? `Could not create the Claude Code session: ${error.message}`
          : "Could not create the Claude Code session.",
      )
      return
    }
  }

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

  return { createClaudeSession, renameClaudeSession, moveClaudeSession, removeClaudeSession }
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
