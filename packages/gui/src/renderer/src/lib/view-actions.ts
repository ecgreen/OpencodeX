import type { OpencodeXTerminalSession, OpencodeXViewMember, Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogProject, ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { metadataWithPendingSessions, metadataWithViewPaneOrder, pendingViewSessions, viewPaneOrder, type PendingViewSession, type ViewPaneOrderItem } from "./view-items"

export { metadataWithPendingSessions } from "./view-items"

export type ViewSelection =
  | { kind: "existing"; sessionID: string }
  | { kind: "terminal"; terminalSessionID: string }
  | { kind: "pending"; slot: PendingViewSession }
export type ViewSessionProjectGroup = { project: ClientCatalogProject; sessions: Session[] }

export function initialViewSelection(view?: ClientCatalogView): ViewSelection[] {
  const selection = [
    ...(view?.members ?? (view?.sessionIDs ?? []).map((id): OpencodeXViewMember => ({ kind: "session", id }))).map((member): ViewSelection => member.kind === "session"
      ? { kind: "existing", sessionID: member.id }
      : { kind: "terminal", terminalSessionID: member.id }),
    ...pendingViewSessions(view).map((slot): ViewSelection => ({ kind: "pending", slot })),
  ]
  const byKey = new Map(selection.map((item) => [selectionKey(item), item]))
  const ordered = viewPaneOrder(view).flatMap((item) => byKey.get(`${item.kind}:${item.id}`) ?? [])
  const included = new Set(ordered.map(selectionKey))
  return [...ordered, ...selection.filter((item) => !included.has(selectionKey(item)))].slice(0, 8)
}

export function selectedViewSessionIDs(selection: ViewSelection[]) {
  return selection
    .filter((item): item is { kind: "existing"; sessionID: string } => item.kind === "existing")
    .map((item) => item.sessionID)
}

export function selectedPendingViewSessions(selection: ViewSelection[]) {
  return selection
    .filter((item): item is { kind: "pending"; slot: PendingViewSession } => item.kind === "pending")
    .map((item) => item.slot)
}

export function selectedViewMembers(selection: ViewSelection[]) {
  return selection.flatMap((item): OpencodeXViewMember[] => {
    if (item.kind === "existing") return [{ kind: "session", id: item.sessionID }]
    if (item.kind === "terminal") return [{ kind: "terminal", id: item.terminalSessionID }]
    return []
  })
}

export function metadataWithViewSelection(metadata: Record<string, unknown> | undefined, selection: ViewSelection[]) {
  return metadataWithViewPaneOrder(
    metadataWithPendingSessions(metadata, selectedPendingViewSessions(selection)),
    selection.map((item): ViewPaneOrderItem => {
      if (item.kind === "existing") return { kind: "session", id: item.sessionID }
      if (item.kind === "terminal") return { kind: "terminal", id: item.terminalSessionID }
      return { kind: "pending", id: item.slot.id }
    }),
  )
}

export function viewTitle(input: { title: string; selection: ViewSelection[]; sessions: Session[]; terminalSessions?: OpencodeXTerminalSession[] }) {
  const trimmed = input.title.trim()
  if (trimmed) return trimmed
  const sessionIDs = selectedViewSessionIDs(input.selection)
  const first = input.sessions.find((session) => session.id === sessionIDs[0])
  if (first && input.selection.length === 1) return first.title
  const selection = input.selection[0]
  const firstTerminal = selection?.kind === "terminal"
    ? input.terminalSessions?.find((session) => session.id === selection.terminalSessionID)
    : undefined
  if (firstTerminal && input.selection.length === 1) return firstTerminal.title
  return `${input.selection.length} session view`
}

export function addPendingViewSessions(input: {
  selection: ViewSelection[]
  count: number
  projectID?: string
  projectLabel?: string
  directory?: string
  now?: number
}) {
  const available = Math.max(0, 8 - input.selection.length)
  const count = Math.min(Math.max(0, input.count), available)
  const stamp = input.now ?? Date.now()
  return [
    ...input.selection,
    ...Array.from({ length: count }, (_, index): ViewSelection => ({
      kind: "pending",
      slot: {
        id: `new:${input.projectID ?? "none"}:${stamp}:${index}`,
        projectID: input.projectID,
        projectLabel: input.projectLabel,
        directory: input.directory,
      },
    })),
  ]
}

export function groupViewSessionsByProject(input: { sessions: Session[]; projects: ClientCatalogProject[] }) {
  const assigned = new Set<string>()
  const projects = input.projects
    .map((project): ViewSessionProjectGroup => {
      const projectSessionIDs = new Set(project.sessionIDs)
      const sessions = input.sessions.filter((session) => {
        if (!projectSessionIDs.has(session.id) || assigned.has(session.id)) return false
        assigned.add(session.id)
        return true
      })
      return { project, sessions }
    })
    .filter((group) => group.sessions.length > 0)
  return {
    projects,
    unprojected: input.sessions.filter((session) => !assigned.has(session.id)),
  }
}

function selectionKey(item: ViewSelection) {
  if (item.kind === "existing") return `session:${item.sessionID}`
  if (item.kind === "terminal") return `terminal:${item.terminalSessionID}`
  return `pending:${item.slot.id}`
}
