/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { Toast } from "@tui/ui/toast"
import { useLocal } from "@tui/context/local"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useBindings } from "../keymap"
import { useOxSidebar } from "./opencodex-sidebar"
import { onOpencodeXRefresh, refreshOpencodeXSidebar } from "./opencodex-refresh"
import { renderViewLayout } from "./opencodex-view-pane"
import {
  metadataWithPendingSessions,
  pendingViewSessions,
  viewItemID,
  viewLayout,
  type OpencodeXView,
  type PendingViewSession,
  type SyncSession,
  type ViewItem,
} from "./opencodex-view-model"

const SESSION_VIEWED_MARK_DELAY_MS = 2_000

export function OpencodeXViewRoute() {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRouteData("opencodex-view")
  const router = useRoute()
  const dialog = useDialog()
  const local = useLocal()
  const themeState = useTheme()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [localFocus, setLocalFocus] = createSignal<string>()
  let authoritativeFocusRevision = ""
  const [loadedView, { refetch }] = createResource(
    () => route.viewID,
    (viewID) => sdk.request<OpencodeXView>(`/experimental/opencodex/view/${viewID}`),
  )
  const view = createMemo(() => sync.data.opencodex_view.find((item) => item.id === route.viewID) ?? loadedView())
  const sessions = createMemo(() => {
    const byID = new Map(sync.data.session.map((session) => [session.id, session]))
    return (view()?.sessionIDs ?? [])
      .map((sessionID) => byID.get(sessionID) ?? view()?.sessions.find((session) => session.id === sessionID))
      .filter((session): session is SyncSession => session !== undefined)
      .slice(0, 8)
  })
  const items = createMemo<ViewItem[]>(() => {
    const current = view()
    if (!current) return []
    const sessionByID = new Map(sessions().map((session) => [session.id, session]))
    // Both fields need the fallback: a server predating this feature sends
    // neither terminalSessions nor members.
    const terminalByID = new Map((current.terminalSessions ?? []).map((terminal) => [terminal.id, terminal]))
    const members = current.members ?? current.sessionIDs.map((id) => ({ kind: "session" as const, id }))
    return [
      ...members.flatMap((member): ViewItem[] => {
        if (member.kind === "session") {
          const session = sessionByID.get(member.id)
          return session ? [{ kind: "session", session }] : []
        }
        const terminal = terminalByID.get(member.id)
        return terminal ? [{ kind: "terminal", terminal }] : []
      }),
      ...pendingViewSessions(current).map((slot): ViewItem => ({ kind: "pending", slot })),
    ].slice(0, 8)
  })
  const focusedItemID = createMemo(() => {
    const known = new Set(items().map(viewItemID))
    if (localFocus() && known.has(localFocus()!)) return localFocus()
    if (view()?.focusedItemID && known.has(view()!.focusedItemID!)) return view()!.focusedItemID
    if (view()?.focusedSessionID && known.has(view()!.focusedSessionID!)) return view()!.focusedSessionID
    return items()[0] ? viewItemID(items()[0]) : undefined
  })

  createEffect(() => {
    const current = view()
    const revision = current ? `${current.id}:${current.timeUpdated}:${current.focusedItemID ?? current.focusedSessionID ?? ""}` : ""
    if (revision === authoritativeFocusRevision) return
    authoritativeFocusRevision = revision
    setLocalFocus(undefined)
  })
  createEffect(() => {
    const focused = focusedItemID()
    if (!focused || items().some((item) => viewItemID(item) === focused)) return
    setLocalFocus(items()[0] ? viewItemID(items()[0]) : undefined)
  })
  createEffect(() => {
    const timers = sessions()
      .filter((session) => local.session.lastViewed(session.id) < session.time.updated)
      .map((session) =>
        setTimeout(
          () => local.session.markViewed(session.id, Math.max(Date.now(), session.time.updated)),
          SESSION_VIEWED_MARK_DELAY_MS,
        ),
      )
    onCleanup(() => timers.forEach(clearTimeout))
  })
  onMount(() => setOxSidebarOpen(() => true))
  onCleanup(
    onOpencodeXRefresh(() => {
      if (router.data.type === "opencodex-view") void refetch()
    }),
  )

  const focus = (id: string) => {
    if (focusedItemID() === id) return
    setLocalFocus(id)
    const item = items().find((candidate) => viewItemID(candidate) === id)
    const current = view()
    if (!current) return
    // Pending slots are not persisted members: the server would discard the
    // focus id but still commit an update, invalidating every client's catalog
    // on each arrow-key press.
    if (item?.kind === "pending") return
    void sdk
      .request<OpencodeXView>(`/experimental/opencodex/view/${route.viewID}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedTimeUpdated: current.timeUpdated,
          focusedItemID: id,
          ...(item?.kind === "session" ? { focusedSessionID: item.session.id } : {}),
        }),
      })
      .catch(() => {
        setLocalFocus(undefined)
        void refetch()
      })
  }

  const move = (offset: number) => {
    if (!items().length) return
    const index = Math.max(0, items().findIndex((item) => viewItemID(item) === focusedItemID()))
    focus(viewItemID(items()[(index + offset + items().length) % items().length]))
  }

  const materializePendingSession = async (slot: PendingViewSession, session: SyncSession) => {
    const current = view()
    if (!current) return
    const pending = pendingViewSessions(current).filter((item) => item.id !== slot.id)
    const members = [
      ...(current.members ?? current.sessionIDs.map((id) => ({ kind: "session" as const, id }))).filter(
        (member) => member.kind !== "session" || member.id !== session.id,
      ),
      { kind: "session" as const, id: session.id },
    ]
    await sdk
      .request<OpencodeXView>(`/experimental/opencodex/view/${route.viewID}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedTimeUpdated: current.timeUpdated,
          members,
          focusedItemID: session.id,
          metadata: metadataWithPendingSessions(current?.metadata, pending),
        }),
      })
      .catch(async (error: Error) => {
        await sdk.request<boolean>(`/experimental/opencodex/session/${session.id}`, { method: "DELETE" }).catch(() => undefined)
        throw error
      })
    setLocalFocus(session.id)
    // One-shot retainer: the pane that mounts next picks the session up inside
    // the deferred-release grace period.
    const release = sync.session.retain(session.id)
    void sync.session.sync(session.id).finally(release)
    await refetch()
    refreshOpencodeXSidebar()
  }

  const deleteView = async () => {
    const current = view()
    if (!current) return
    if ((await DialogConfirm.show(dialog, "Delete view", `Delete "${current.title}"?`, "keep")) !== true) return
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
        when={items().length}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={themeState.theme.textMuted}>This view has no available sessions.</text>
          </box>
        }
      >
        {renderViewLayout({
          node: viewLayout(items().length),
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

export { viewLayout } from "./opencodex-view-model"
