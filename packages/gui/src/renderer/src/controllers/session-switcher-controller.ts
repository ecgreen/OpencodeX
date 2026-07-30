import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { OpencodeXTerminalSession, Session } from "@opencode-ai/sdk/v2/client"
import type { createNavigationController } from "./navigation-controller"
import type { createSessionActionsController } from "./session-actions-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import { displayClientMessageText } from "@opencode-ai/sdk/v2/client-sync"
import { isTerminalSessionRecordID } from "./claude-terminal-controller"
import { initialMruCursor, loadMruSessions, moveMruCursor, mruSessionCandidates, pruneMruSessions, saveMruSessions, touchMruSession } from "../lib/mru-sessions"
import { textPart } from "../lib/session-composer-helpers"
import type { MessageBundle } from "../lib/store-types"

export type SwitcherPreviewRow = { role: string; text: string }
export type SwitcherSessionItem =
  | { kind: "session"; id: string; title: string; projectID?: string; directory: string; time: { updated: number }; timeUpdated: number; session: Session }
  | { kind: "terminal"; id: string; title: string; projectID?: string; directory: string; time: { updated: number }; timeUpdated: number; terminalSession: OpencodeXTerminalSession }

const PREVIEW_MESSAGE_LIMIT = 4
const PREVIEW_TEXT_LIMIT = 280

export function createSessionSwitcherController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  navigation: ReturnType<typeof createNavigationController>
  selection: ReturnType<typeof createSessionSelectionController>
  sessionActions: ReturnType<typeof createSessionActionsController>
}) {
  const [mru, setMru] = createSignal<string[]>(loadMruSessions())
  const [open, setOpen] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [sticky, setSticky] = createSignal(false)

  createEffect(() => {
    const route = input.navigation.route()
    const sessionID = route.name === "terminal-session" ? route.terminalSessionID : input.selection.activeSessionID()
    if (!sessionID || sessionID.startsWith("pending:")) return
    setMru((list) => persist(touchMruSession(list, sessionID)))
  })

  createEffect(() => {
    const state = input.authoritative.state()
    if (!state) return
    const missing = state.tombstones.sessions
    const terminalSessionIDs = new Set(input.authoritative.snapshot()?.terminalSessions.map((session) => session.id) ?? [])
    setMru((list) => {
      const validIDs = new Set(list.filter((sessionID) => isTerminalSessionRecordID(sessionID) ? terminalSessionIDs.has(sessionID) : !missing[sessionID]))
      const next = pruneMruSessions(list, validIDs)
      return next === list ? list : persist(next)
    })
  })

  const sessions = createMemo(() => mruSessionCandidates(mru(), input.authoritative.snapshot()?.sessions ?? []))
  const items = createMemo<SwitcherSessionItem[]>(() => {
    const normal = sessions().map((session): SwitcherSessionItem => ({
      kind: "session",
      id: session.id,
      title: session.title,
      projectID: session.projectID,
      directory: session.directory,
      time: { updated: session.time.updated },
      timeUpdated: session.time.updated,
      session,
    }))
    const terminal = (input.authoritative.snapshot()?.terminalSessions ?? []).map((terminalSession): SwitcherSessionItem => ({
      kind: "terminal",
      id: terminalSession.id,
      title: terminalSession.title,
      projectID: terminalSession.projectID,
      directory: terminalSession.directory,
      time: { updated: Number(terminalSession.timeOpened ?? terminalSession.timeUpdated) },
      timeUpdated: Number(terminalSession.timeOpened ?? terminalSession.timeUpdated),
      terminalSession,
    }))
    const byID = new Map([...normal, ...terminal].map((item) => [item.id, item]))
    const recent = mru().flatMap((id) => byID.get(id) ?? [])
    const included = new Set(recent.map((item) => item.id))
    return [...recent, ...[...normal, ...terminal].filter((item) => !included.has(item.id))]
  })

  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return items()
    return items().filter((session) => [session.title, session.directory, session.kind === "terminal" ? "claude code" : "opencode"].some((value) => value.toLowerCase().includes(needle)))
  })

  const activeSessionID = () => {
    const route = input.navigation.route()
    return route.name === "terminal-session" ? route.terminalSessionID : input.selection.activeSessionID()
  }

  function cycle(direction: 1 | -1) {
    if (!open()) {
      setOpen(true)
      setSticky(false)
      setQuery("")
      setCursor(initialMruCursor(activeSessionID(), rows().map((session) => session.id), direction))
      return
    }
    setCursor((current) => moveMruCursor(current, direction, rows().length))
  }

  function commit(index = cursor()) {
    const session = rows()[index]
    setOpen(false)
    setSticky(false)
    if (!session || session.id === activeSessionID()) return
    if (session.kind === "terminal") {
      input.navigation.setRoute({ name: "terminal-session", terminalSessionID: session.id })
      return
    }
    input.sessionActions.open(session.id)
  }

  function move(offset: 1 | -1) {
    setCursor((current) => moveMruCursor(current, offset, rows().length))
  }

  function jumpToIndex(index: number) {
    const session = items()[index]
    if (!session || session.id === activeSessionID()) return
    if (session.kind === "terminal") {
      input.navigation.setRoute({ name: "terminal-session", terminalSessionID: session.id })
      return
    }
    input.sessionActions.open(session.id)
  }

  function filter(value: string) {
    setSticky(true)
    setQuery(value)
    setCursor(0)
  }

  function openSearch() {
    setOpen(true)
    setSticky(true)
    setQuery("")
    setCursor(0)
  }

  function preview(sessionID: string): SwitcherPreviewRow[] {
    if (isTerminalSessionRecordID(sessionID)) return []
    const data = input.authoritative.selectedSessionDataCache()[sessionID]?.data
    if (!data) return []
    return data.messages
      .slice(-PREVIEW_MESSAGE_LIMIT)
      .map((bundle) => ({ role: bundle.info.role, text: previewText(bundle.parts) }))
      .filter((row) => row.text)
  }

  onMount(() => {
    const handleKeyup = (event: KeyboardEvent) => {
      if (!open()) return
      if (!sticky() && (event.key === "Control" || event.key === "Meta" || event.key === "Alt")) commit()
    }
    window.addEventListener("keyup", handleKeyup)
    onCleanup(() => window.removeEventListener("keyup", handleKeyup))
  })

  return {
    open,
    cursor,
    setCursor,
    query,
    sticky,
    filter,
    rows,
    sessions,
    items,
    cycle,
    openSearch,
    move,
    commit,
    cancel: () => { setOpen(false); setSticky(false) },
    jumpToIndex,
    preview,
  }
}

function persist(list: readonly string[]) {
  saveMruSessions(list)
  return [...list]
}

function previewText(parts: MessageBundle["parts"]) {
  const text = parts.map(textPart).filter(Boolean).join("\n")
  const display = displayClientMessageText(text).replace(/\s+/g, " ").trim()
  return display.length > PREVIEW_TEXT_LIMIT ? `${display.slice(0, PREVIEW_TEXT_LIMIT)}…` : display
}
