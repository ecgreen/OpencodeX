import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import { title } from "../lib/format"
import { projectNameForSession } from "../lib/project-name"
import { deriveSessionStatus, sessionStatusLabel, sessionStatusTone } from "../lib/session-status"
import type { GuiSnapshot } from "../lib/session-api"
import type { PaletteTarget } from "./command-palette"

export function sessionPaletteTarget(snapshot: GuiSnapshot, session: Session, open: (sessionID: string) => void): PaletteTarget {
  const status = deriveSessionStatus(snapshot, session)
  return {
    kind: "session",
    id: session.id,
    title: title(session.title),
    subtitle: projectNameForSession(snapshot.projects, session),
    status: sessionStatusLabel(status),
    statusTone: sessionStatusTone(status),
    time: session.time.updated,
    run: () => open(session.id),
  }
}

export function terminalSessionPaletteTarget(
  terminalSession: OpencodeXTerminalSession,
  status: string,
  open: (terminalSessionID: string) => void,
): PaletteTarget {
  return {
    kind: "session",
    id: terminalSession.id,
    title: title(terminalSession.title),
    subtitle: `Claude Code · ${terminalSession.directory}`,
    status,
    statusTone: status === "running" ? "success" : status === "error" || status === "missing-cli" ? "danger" : "neutral",
    time: Number(terminalSession.timeOpened ?? terminalSession.timeUpdated),
    run: () => open(terminalSession.id),
  }
}

export function titlebarPageLabel(routeName: string) {
  if (routeName === "new-session") return "New session"
  if (routeName === "swarm-create") return "New swarm"
  if (routeName === "view-edit") return "Edit view"
  if (routeName === "diff") return "Diff"
  return routeName.charAt(0).toUpperCase() + routeName.slice(1)
}
