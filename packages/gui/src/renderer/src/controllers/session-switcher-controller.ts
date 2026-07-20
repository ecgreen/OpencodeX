import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import type { createSessionActionsController } from "./session-actions-controller"
import type { createSessionSelectionController } from "./session-selection-controller"
import { displayMessageText } from "../lib/message-text"
import { initialMruCursor, loadMruSessions, moveMruCursor, mruSessionCandidates, pruneMruSessions, saveMruSessions, touchMruSession } from "../lib/mru-sessions"
import { textPart } from "../lib/session-composer-helpers"
import type { MessageBundle } from "../lib/store-types"

export type SwitcherPreviewRow = { role: string; text: string }

const PREVIEW_MESSAGE_LIMIT = 4
const PREVIEW_TEXT_LIMIT = 280

export function createSessionSwitcherController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  selection: ReturnType<typeof createSessionSelectionController>
  sessionActions: ReturnType<typeof createSessionActionsController>
}) {
  const [mru, setMru] = createSignal<string[]>(loadMruSessions())
  const [open, setOpen] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [sticky, setSticky] = createSignal(false)

  createEffect(() => {
    const sessionID = input.selection.activeSessionID()
    if (!sessionID || sessionID.startsWith("pending:")) return
    setMru((list) => persist(touchMruSession(list, sessionID)))
  })

  createEffect(() => {
    const state = input.authoritative.state()
    if (!state) return
    const missing = state.tombstones.sessions
    setMru((list) => {
      const validIDs = new Set(list.filter((sessionID) => !missing[sessionID]))
      const next = pruneMruSessions(list, validIDs)
      return next === list ? list : persist(next)
    })
  })

  const sessions = createMemo(() => mruSessionCandidates(mru(), input.authoritative.snapshot()?.sessions ?? []))

  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return sessions()
    return sessions().filter((session) => session.title.toLowerCase().includes(needle))
  })

  function cycle(direction: 1 | -1) {
    if (!open()) {
      setOpen(true)
      setSticky(false)
      setQuery("")
      setCursor(initialMruCursor(input.selection.activeSessionID(), rows().map((session) => session.id), direction))
      return
    }
    setCursor((current) => moveMruCursor(current, direction, rows().length))
  }

  function commit(index = cursor()) {
    const session = rows()[index]
    setOpen(false)
    setSticky(false)
    if (!session || session.id === input.selection.activeSessionID()) return
    input.sessionActions.open(session.id)
  }

  function move(offset: 1 | -1) {
    setCursor((current) => moveMruCursor(current, offset, rows().length))
  }

  function jumpToIndex(index: number) {
    const session = sessions()[index]
    if (!session || session.id === input.selection.activeSessionID()) return
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
  const display = displayMessageText(text).replace(/\s+/g, " ").trim()
  return display.length > PREVIEW_TEXT_LIMIT ? `${display.slice(0, PREVIEW_TEXT_LIMIT)}…` : display
}
