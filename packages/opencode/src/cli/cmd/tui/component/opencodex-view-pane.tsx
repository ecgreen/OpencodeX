/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { PermissionPrompt } from "../routes/session/permission"
import { QuestionPrompt } from "../routes/session/question"
import { deriveStatus, statusColor, statusLabel } from "./opencodex-session-status"
import {
  truncateViewText,
  viewItemID,
  viewMessageText,
  type LayoutNode,
  type PendingViewSession,
  type SyncSession,
  type ViewItem,
} from "./opencodex-view-model"

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
  const themeState = useTheme()
  const [ref, setRef] = createSignal<PromptRef>()
  const session = createMemo(() => (props.item.kind === "session" ? props.item.session : undefined))
  const terminal = createMemo(() => (props.item.kind === "terminal" ? props.item.terminal : undefined))
  const pending = createMemo(() => (props.item.kind === "pending" ? props.item.slot : undefined))
  const id = createMemo(() => viewItemID(props.item))
  const messages = createMemo(() => (session() ? (sync.data.message[session()!.id] ?? []) : []))
  const recent = createMemo(() => messages().slice(Math.max(0, messages().length - 24)))
  const status = createMemo(() => (session() ? deriveStatus(session()!.id, sync) : "dormant"))
  const permissions = createMemo(() => (session() ? (sync.data.permission[session()!.id] ?? []) : []))
  const questions = createMemo(() => (session() ? (sync.data.question[session()!.id] ?? []) : []))
  let focusTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (focusTimer) clearTimeout(focusTimer)
    const current = ref()
    if (!props.focused() || !current) return
    promptRef.set(current)
    focusTimer = setTimeout(() => current.focus(), 0)
  })
  onCleanup(() => {
    if (focusTimer) clearTimeout(focusTimer)
  })
  createEffect(() => {
    const current = session()
    if (!current) return
    onCleanup(sync.session.retain(current.id))
    void sync.session.sync(current.id)
  })

  const createSession = async (input: {
    workspaceID?: string
    agent: string
    model: { providerID: string; id: string; variant?: string }
  }) => {
    const slot = pending()
    if (!slot) return undefined
    if (slot.projectID) {
      return sdk.request<SyncSession>("/experimental/opencodex/session", {
        method: "POST",
        body: JSON.stringify({ projectID: slot.projectID, directory: slot.directory, ...input }),
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

  return (
    <box
      flexGrow={1}
      flexBasis={0}
      flexShrink={1}
      minWidth={24}
      minHeight={8}
      flexDirection="column"
      border={["left", "right", "top", "bottom"]}
      borderColor={props.focused() ? themeState.theme.primary : themeState.theme.border}
      backgroundColor={props.focused() ? themeState.theme.backgroundPanel : undefined}
      onMouseUp={props.onFocus}
    >
      <box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text
          attributes={props.focused() ? TextAttributes.BOLD : undefined}
          fg={props.focused() ? themeState.theme.primary : themeState.theme.text}
        >
          {truncateViewText(session()?.title ?? terminal()?.title ?? "New session", 42)}
        </text>
        <text fg={terminal() ? themeState.theme.textMuted : statusColor(status())}>
          {terminal() ? "CLAUDE CODE" : statusLabel(status())}
        </text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} stickyScroll={true} stickyStart="bottom">
        <Show
          when={terminal()}
          fallback={
            <Show
              when={recent().length}
              fallback={
                <text fg={themeState.theme.textMuted}>
                  {pending() ? "This pane will create a session when you send a prompt." : "No messages yet."}
                </text>
              }
            >
              <For each={recent()}>
                {(message) => {
                  const text = createMemo(() => viewMessageText(message, sync.data.part[message.id] ?? []))
                  return (
                    <Show when={text()}>
                      <box flexShrink={0} flexDirection="column" paddingBottom={1}>
                        <text fg={message.role === "user" ? themeState.theme.primary : themeState.theme.textMuted}>
                          {message.role === "user" ? "You" : "Assistant"}
                        </text>
                        <text fg={themeState.theme.text}>{truncateViewText(text(), 800)}</text>
                      </box>
                    </Show>
                  )
                }}
              </For>
            </Show>
          }
        >
          <box flexDirection="column" gap={1}>
            <text fg={themeState.theme.text}>Claude Code session</text>
            <text fg={themeState.theme.textMuted}>Open this pane in OpencodeX Desktop to use its terminal.</text>
            <text fg={themeState.theme.textMuted}>Claude Code owns authentication and conversation history.</text>
          </box>
        </Show>
      </scrollbox>
      <Show when={!terminal()}>
        <box flexShrink={0} paddingLeft={1} paddingRight={1}>
          <Show when={props.focused() && permissions().length}>
            <PermissionPrompt request={permissions()[0]} />
          </Show>
          <Show when={props.focused() && !permissions().length && questions().length}>
            <QuestionPrompt request={questions()[0]} />
          </Show>
          <Prompt
            ref={setRef}
            sessionID={session()?.id}
            disabled={!props.focused()}
            useSessionContext={props.item.kind === "session"}
            draftKey={`opencodex-view:${props.viewID}:${id()}`}
            createSession={pending() ? createSession : undefined}
            onSessionCreated={
              pending()
                ? async (created) => {
                    const slot = pending()
                    if (slot) await props.onSessionCreated(slot, created)
                  }
                : undefined
            }
            stayOnSessionCreated={props.item.kind === "pending"}
            showPlaceholder={props.focused()}
          />
        </box>
      </Show>
      <box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <text fg={themeState.theme.textMuted}>
          {truncateViewText(session()?.directory ?? terminal()?.directory ?? pending()?.directory ?? "No project", 52)}
        </text>
        <Show when={session()}>
          {(current) => (
            <text fg={themeState.theme.textMuted} onMouseUp={() => route.navigate({ type: "session", sessionID: current().id })}>
              open
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}

export function renderViewLayout(input: {
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
        focused={() => input.focusedItemID() === viewItemID(item)}
        onFocus={() => input.focus(viewItemID(item))}
        onSessionCreated={input.onSessionCreated}
      />
    )
  }
  return (
    <box flexGrow={1} flexBasis={0} flexShrink={1} minHeight={0} minWidth={0} flexDirection={input.node.direction} gap={1}>
      <For each={input.node.children}>{(node) => renderViewLayout({ ...input, node })}</For>
    </box>
  )
}
