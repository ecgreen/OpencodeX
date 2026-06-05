import { TextAttributes } from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { Toast } from "@tui/ui/toast"
import { useLocal } from "@tui/context/local"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useBindings } from "../keymap"
import { useOxSidebar } from "./opencodex-sidebar"
import { onOpencodeXRefresh, refreshOpencodeXSidebar } from "./opencodex-refresh"
import { deriveStatus, statusColor, statusLabel } from "./opencodex-session-status"

type SyncContext = ReturnType<typeof useSync>
type SyncSession = SyncContext["data"]["session"][number]
type SyncMessage = NonNullable<SyncContext["data"]["message"][string]>[number]
type SyncPart = NonNullable<SyncContext["data"]["part"][string]>[number]

type OpencodeXView = {
  id: string
  title: string
  focusedSessionID?: string
  layout: string
  sessions: SyncSession[]
  sessionIDs: string[]
  metadata?: Record<string, unknown>
  timeUpdated: number
}

type PendingViewSession = {
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}

type ViewItem = { kind: "session"; session: SyncSession } | { kind: "pending"; slot: PendingViewSession }

type LayoutNode =
  | number
  | {
      direction: "row" | "column"
      children: LayoutNode[]
    }

export function viewLayout(count: number): LayoutNode {
  if (count <= 1) return 0
  if (count === 2) return { direction: "row", children: [0, 1] }
  if (count === 3) return { direction: "row", children: [0, { direction: "column", children: [1, 2] }] }
  if (count === 4) {
    return {
      direction: "column",
      children: [
        { direction: "row", children: [0, 1] },
        { direction: "row", children: [2, 3] },
      ],
    }
  }
  if (count === 5) {
    return {
      direction: "row",
      children: [
        { direction: "column", children: [0, 1, 2] },
        { direction: "column", children: [3, 4] },
      ],
    }
  }
  if (count === 6) {
    return {
      direction: "column",
      children: [
        { direction: "row", children: [0, 1, 2] },
        { direction: "row", children: [3, 4, 5] },
      ],
    }
  }
  if (count === 7) {
    return {
      direction: "row",
      children: [
        { direction: "column", children: [0, 1, 2, 3] },
        { direction: "column", children: [4, 5, 6] },
      ],
    }
  }
  return {
    direction: "column",
    children: [
      { direction: "row", children: [0, 1, 2, 3] },
      { direction: "row", children: [4, 5, 6, 7] },
    ],
  }
}

function truncate(input: string, length: number) {
  if (input.length <= length) return input
  return input.slice(0, Math.max(0, length - 3)) + "..."
}

function partText(part: SyncPart) {
  if (part.type === "text") return part.text.trim()
  if (part.type === "file") return `[file] ${part.filename ?? part.url}`
  if (part.type === "agent") return `[agent] ${part.name}`
  if (part.type === "tool") {
    if (part.state.status === "running") return `[tool] ${part.tool}${part.state.title ? ` ${part.state.title}` : ""}`
    if (part.state.status === "completed") return `[tool] ${part.tool}${part.state.title ? ` ${part.state.title}` : ""}`
    return `[tool] ${part.tool}`
  }
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pendingViewSessions(view?: Pick<OpencodeXView, "metadata">): PendingViewSession[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.pendingSessions)) return []
  return opencodex.pendingSessions.flatMap((item): PendingViewSession[] => {
    if (!isRecord(item) || typeof item.id !== "string") return []
    return [
      {
        id: item.id,
        projectID: typeof item.projectID === "string" ? item.projectID : undefined,
        projectLabel: typeof item.projectLabel === "string" ? item.projectLabel : undefined,
        directory: typeof item.directory === "string" ? item.directory : undefined,
      },
    ]
  })
}

function metadataWithPendingSessions(metadata: Record<string, unknown> | undefined, pending: PendingViewSession[]) {
  const next = { ...(metadata ?? {}) }
  const opencodex = isRecord(next.opencodex) ? { ...next.opencodex } : {}
  if (pending.length > 0) {
    opencodex.pendingSessions = pending
    next.opencodex = opencodex
    return next
  }
  delete opencodex.pendingSessions
  if (Object.keys(opencodex).length > 0) next.opencodex = opencodex
  else delete next.opencodex
  return next
}

function itemID(item: ViewItem) {
  return item.kind === "session" ? item.session.id : item.slot.id
}

function messageText(message: SyncMessage, parts: SyncPart[]) {
  const text = parts
    .map(partText)
    .filter(Boolean)
    .join("\n")
  if (text) return text
  return message.role === "assistant" ? "Thinking..." : ""
}

function ViewPane(props: {
  viewID: string
  item: ViewItem
  focused: () => boolean
  onFocus: () => void
  onSessionCreated: (slot: PendingViewSession, session: SyncSession) => Promise<void>
}) {
  const sync = useSync()
  const sdk = useSDK()
  const promptRef = usePromptRef()
  const route = useRoute()
  const { theme } = useTheme()
  const [ref, setRef] = createSignal<PromptRef>()
  const session = createMemo(() => props.item.kind === "session" ? props.item.session : undefined)
  const pending = createMemo(() => props.item.kind === "pending" ? props.item.slot : undefined)
  const id = createMemo(() => itemID(props.item))
  const messages = createMemo(() => session() ? sync.data.message[session()!.id] ?? [] : [])
  const recent = createMemo(() => messages().slice(Math.max(0, messages().length - 24)))
  const status = createMemo(() => session() ? deriveStatus(session()!.id, sync) : "dormant")

  createEffect(() => {
    const current = ref()
    if (!props.focused() || !current) return
    promptRef.set(current)
    setTimeout(() => current.focus(), 0)
  })

  onMount(() => {
    const current = session()
    if (current) void sync.session.sync(current.id)
  })

  async function createSession(input: { workspaceID?: string; agent: string; model: { providerID: string; id: string; variant?: string } }) {
    const slot = pending()
    if (!slot) return undefined
    if (slot.projectID) {
      return await sdk.request<SyncSession>("/experimental/opencodex/session", {
        method: "POST",
        body: JSON.stringify({
          projectID: slot.projectID,
          directory: slot.directory,
          ...input,
        }),
      })
    }
    const result = await sdk.client.session.create({
      workspace: input.workspaceID,
      agent: input.agent,
      model: input.model,
    })
    if (result.error) throw result.error
    return result.data
  }

  async function handleSessionCreated(created: SyncSession) {
    const slot = pending()
    if (!slot) return
    await props.onSessionCreated(slot, created)
  }

  return (
    <box
      flexGrow={1}
      flexBasis={0}
      flexShrink={1}
      minWidth={24}
      minHeight={8}
      flexDirection="column"
      border={["left", "right", "top", "bottom"]}
      borderColor={props.focused() ? theme.primary : theme.border}
      backgroundColor={props.focused() ? theme.backgroundPanel : undefined}
      onMouseUp={props.onFocus}
    >
      <box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text attributes={props.focused() ? TextAttributes.BOLD : undefined} fg={props.focused() ? theme.primary : theme.text}>
          {truncate(session()?.title ?? "New session", 42)}
        </text>
        <text fg={statusColor(status())}>{statusLabel(status())}</text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} stickyScroll={true} stickyStart="bottom">
        <Show when={recent().length > 0} fallback={<text fg={theme.textMuted}>{pending() ? "This pane will create a session when you send a prompt." : "No messages yet."}</text>}>
          <For each={recent()}>
            {(message) => {
              const text = createMemo(() => messageText(message, sync.data.part[message.id] ?? []))
              return (
                <Show when={text()}>
                  <box flexShrink={0} flexDirection="column" paddingBottom={1}>
                    <text fg={message.role === "user" ? theme.primary : theme.textMuted}>
                      {message.role === "user" ? "You" : "Assistant"}
                    </text>
                    <text fg={theme.text}>{truncate(text(), 800)}</text>
                  </box>
                </Show>
              )
            }}
          </For>
        </Show>
      </scrollbox>
      <box flexShrink={0} paddingLeft={1} paddingRight={1}>
        <Prompt
          ref={setRef}
          sessionID={session()?.id}
          disabled={!props.focused()}
          useSessionContext={props.item.kind === "session"}
          draftKey={`opencodex-view:${props.viewID}:${id()}`}
          createSession={pending() ? createSession : undefined}
          onSessionCreated={pending() ? handleSessionCreated : undefined}
          stayOnSessionCreated={props.item.kind === "pending"}
          showPlaceholder={props.focused()}
        />
      </box>
      <box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{truncate(session()?.directory ?? pending()?.directory ?? "No project", 52)}</text>
        <Show when={session()}>
          {(current) => (
            <text fg={theme.textMuted} onMouseUp={() => route.navigate({ type: "session", sessionID: current().id })}>
              open
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}

function renderLayout(input: {
  node: LayoutNode
  items: ViewItem[]
  viewID: string
  focusedItemID: () => string | undefined
  focus: (id: string) => void
  onSessionCreated: (slot: PendingViewSession, session: SyncSession) => Promise<void>
}): JSX.Element {
  if (typeof input.node === "number") {
    const item = input.items[input.node]
    if (!item) return <></>
    return (
      <ViewPane
        viewID={input.viewID}
        item={item}
        focused={() => input.focusedItemID() === itemID(item)}
        onFocus={() => input.focus(itemID(item))}
        onSessionCreated={input.onSessionCreated}
      />
    )
  }
  return (
    <box flexGrow={1} flexBasis={0} flexShrink={1} minHeight={0} minWidth={0} flexDirection={input.node.direction} gap={1}>
      <For each={input.node.children}>
        {(node) => renderLayout({ ...input, node })}
      </For>
    </box>
  )
}

export function OpencodeXViewRoute() {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRouteData("opencodex-view")
  const router = useRoute()
  const dialog = useDialog()
  const local = useLocal()
  const { theme } = useTheme()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [localFocus, setLocalFocus] = createSignal<string>()
  const [view, { refetch }] = createResource(
    () => route.viewID,
    (viewID) => sdk.request<OpencodeXView>(`/experimental/opencodex/view/${viewID}`),
  )
  const sessions = createMemo(() => {
    const byID = new Map(sync.data.session.map((session) => [session.id, session]))
    return (view()?.sessionIDs ?? [])
      .map((sessionID) => byID.get(sessionID) ?? view()?.sessions.find((session) => session.id === sessionID))
      .filter((session): session is SyncSession => session !== undefined)
      .slice(0, 8)
  })
  const items = createMemo<ViewItem[]>(() => [
    ...sessions().map((session): ViewItem => ({ kind: "session", session })),
    ...pendingViewSessions(view()).map((slot): ViewItem => ({ kind: "pending", slot })),
  ].slice(0, 8))
  const focusedItemID = createMemo(() => {
    const known = new Set(items().map(itemID))
    const local = localFocus()
    if (local && known.has(local)) return local
    const focused = view()?.focusedSessionID
    if (focused && known.has(focused)) return focused
    return items()[0] ? itemID(items()[0]) : undefined
  })
  const layout = createMemo(() => viewLayout(items().length))

  createEffect(() => {
    const focused = focusedItemID()
    if (!focused || items().some((item) => itemID(item) === focused)) return
    const first = items()[0]
    setLocalFocus(first ? itemID(first) : undefined)
  })

  createEffect(() => {
    sessions()
      .filter((session) => local.session.lastViewed(session.id) < session.time.updated)
      .forEach((session) => local.session.markViewed(session.id, Math.max(Date.now(), session.time.updated)))
  })

  onMount(() => {
    setOxSidebarOpen(() => true)
  })

  onCleanup(onOpencodeXRefresh(() => {
    if (router.data.type === "opencodex-view") void refetch()
  }))

  function focus(id: string) {
    if (focusedItemID() === id) return
    setLocalFocus(id)
    const item = items().find((item) => itemID(item) === id)
    if (item?.kind !== "session") return
    void sdk
      .request<OpencodeXView>(`/experimental/opencodex/view/${route.viewID}`, {
        method: "PATCH",
        body: JSON.stringify({ focusedSessionID: item.session.id }),
      })
      .catch(() => {})
  }

  function move(offset: number) {
    const list = items()
    if (list.length === 0) return
    const index = Math.max(0, list.findIndex((item) => itemID(item) === focusedItemID()))
    focus(itemID(list[(index + offset + list.length) % list.length]))
  }

  async function materializePendingSession(slot: PendingViewSession, session: SyncSession) {
    const current = view()
    const pending = pendingViewSessions(current).filter((item) => item.id !== slot.id)
    const sessionIDs = [...(current?.sessionIDs ?? []).filter((sessionID) => sessionID !== session.id), session.id]
    await sdk.request<OpencodeXView>(`/experimental/opencodex/view/${route.viewID}`, {
      method: "PATCH",
      body: JSON.stringify({
        sessionIDs,
        focusedSessionID: session.id,
        metadata: metadataWithPendingSessions(current?.metadata, pending),
      }),
    }).catch(async (error: Error) => {
      await sdk.request<boolean>(`/experimental/opencodex/session/${session.id}`, { method: "DELETE" }).catch(() => undefined)
      throw error
    })
    setLocalFocus(session.id)
    void sync.session.sync(session.id)
    await refetch()
    refreshOpencodeXSidebar()
  }

  async function deleteView() {
    const current = view()
    if (!current) return
    const confirmed = await DialogConfirm.show(dialog, "Delete view", `Delete "${current.title}"?`, "keep")
    if (confirmed !== true) return
    const removed = await sdk
      .request<boolean>(`/experimental/opencodex/view/${current.id}`, { method: "DELETE" })
      .catch((error: Error) => {
        void DialogAlert.show(dialog, "Delete View", error.message)
      })
    if (!removed) return
    router.navigate({ type: "opencodex-dashboard" })
    refreshOpencodeXSidebar()
  }

  useBindings(() => ({
    enabled: router.data.type === "opencodex-view",
    commands: [
      { name: "opencodex.view.next", title: "Focus next view pane", category: "Views", hidden: true, run: () => move(1) },
      { name: "opencodex.view.previous", title: "Focus previous view pane", category: "Views", hidden: true, run: () => move(-1) },
      { name: "opencodex.view.delete_current", title: "Delete current view", category: "Views", hidden: true, run: () => void deleteView() },
    ],
    bindings: [
      { key: "right", desc: "Focus next pane", group: "OpencodeX View", cmd: () => move(1) },
      { key: "left", desc: "Focus previous pane", group: "OpencodeX View", cmd: () => move(-1) },
    ],
  }))

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <Show
        when={items().length > 0}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.textMuted}>This view has no available sessions.</text>
          </box>
        }
      >
        {renderLayout({
          node: layout(),
          items: items(),
          viewID: route.viewID,
          focusedItemID,
          focus,
          onSessionCreated: materializePendingSession,
        })}
      </Show>
      <Toast />
    </box>
  )
}
