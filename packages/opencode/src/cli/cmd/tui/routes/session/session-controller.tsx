import { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { clientPlanModeSwitch } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { Locale } from "@/util/locale"
import { UI } from "@/cli/ui"
import { OPENCODEX_SIDEBAR_WIDTH } from "@tui/component/opencodex-sidebar"
import { type PromptRef } from "@tui/component/prompt"
import { useEditorContext } from "@tui/context/editor"
import { useEvent } from "@tui/context/event"
import { useExit } from "@tui/context/exit"
import { useKV } from "@tui/context/kv"
import { useLocal } from "@tui/context/local"
import { useProject } from "@tui/context/project"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useThinkingMode } from "@tui/context/thinking"
import { useTuiConfig } from "@tui/context/tui-config"
import { useOpencodeKeymap } from "@tui/keymap"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@/util/error"
import { getRevertDiffFiles } from "@tui/util/revert-diff"
import { getScrollAcceleration } from "@tui/util/scroll"
import { index } from "@tui/util/model"

const SESSION_VIEWED_MARK_DELAY_MS = 2_000

export function createSessionRouteController() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const event = useEvent()
  const project = useProject()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })
  const visible = createMemo(() => !session()?.parentID && permissions().length === 0 && questions().length === 0)
  const disabled = createMemo(() => permissions().length > 0 || questions().length > 0)

  const pending = createMemo(() => {
    const completed = messages().findLast((x) => x.role === "assistant" && x.time.completed)?.id
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed && (!completed || x.id > completed))
      ?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })
  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [oxSidebarOpen, setOxSidebarOpen] = kv.signal<boolean>("ox_sidebar_visible", false)
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const thinking = useThinkingMode()
  const thinkingMode = thinking.mode
  const showThinking = createMemo(() => true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, _setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [_animationsEnabled, _setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() =>
    Math.max(20, dimensions().width - (oxSidebarOpen() ? OPENCODEX_SIDEBAR_WIDTH : 0) - (sidebarVisible() ? 42 : 0) - 4),
  )
  const providers = createMemo(() => index(sync.data.provider))

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const toast = useToast()
  const sdk = useSDK()
  const editor = useEditorContext()

  createEffect(() => {
    const sessionID = route.sessionID
    // Holds the transcript resident while this route is on screen; leaving it
    // hands the session to the deferred-release grace period.
    onCleanup(sync.session.retain(sessionID))
    void (async () => {
      const previousWorkspace = untrack(() => project.workspace.current())
      const result = await sdk.client.session.get({ sessionID }, { throwOnError: true })
      if (!result.data) {
        toast.show({
          message: `Session not found: ${sessionID}`,
          variant: "error",
          duration: 5000,
        })
        navigate({ type: "home" })
        return
      }

      if (result.data.workspaceID !== previousWorkspace) {
        project.workspace.set(result.data.workspaceID)

        // Sync all the data for this workspace. Note that this
        // workspace may not exist anymore which is why this is not
        // fatal. If it doesn't we still want to show the session
        // (which will be non-interactive)
        await sync.bootstrap({ fatal: false }).catch(() => {})
      }
      editor.reconnect(result.data.directory)
      await sync.session.sync(sessionID)
      if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
    })().catch((error) => {
      if (route.sessionID !== sessionID) return
      toast.show({
        message: errorMessage(error),
        variant: "error",
        duration: 5000,
      })
      navigate({ type: "home" })
    })
  })

  let lastSwitch: string | undefined = undefined
  onCleanup(event.on("message.part.updated", (evt) => {
    const change = clientPlanModeSwitch(evt)
    if (!change || change.sessionID !== route.sessionID || change.partID === lastSwitch) return
    local.agent.set(change.agent)
    lastSwitch = change.partID
  }))

  let seeded = false
  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const bind = (r: PromptRef | undefined) => {
    prompt = r
    promptRef.set(r)
    if (seeded || !route.prompt || !r) return
    seeded = true
    r.set(route.prompt)
  }
  const keymap = useOpencodeKeymap()
  const dialog = useDialog()
  const renderer = useRenderer()

  const exit = useExit()

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    const pad = (text: string) => text.padEnd(10, " ")
    const weak = (text: string) => UI.Style.TEXT_DIM + pad(text) + UI.Style.TEXT_NORMAL
    const logo = UI.logo("  ").split(/\r?\n/)
    return exit.message.set(
      [
        `${logo[0] ?? ""}`,
        `${logo[1] ?? ""}`,
        `${logo[2] ?? ""}`,
        `${logo[3] ?? ""}`,
        ``,
        `  ${weak("Session")}${UI.Style.TEXT_NORMAL_BOLD}${title}${UI.Style.TEXT_NORMAL}`,
        `  ${weak("Continue")}${UI.Style.TEXT_NORMAL_BOLD}opencode -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,
        ``,
      ].join("\n"),
    )
  })

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  createEffect(on(() => `${route.sessionID}:${session()?.time.updated ?? 0}`, () => {
    const current = session()
    if (!current) return
    const timer = setTimeout(() => local.session.markViewed(route.sessionID, Math.max(Date.now(), current.time.updated)), SESSION_VIEWED_MARK_DELAY_MS)
    onCleanup(() => clearTimeout(timer))
  }))

  function enterChild(sessionID: string) {
    navigate({
      type: "session",
      sessionID,
    })
    const status = sync.data.session_status[sessionID]
    if (status?.type === "retry") void DialogAlert.show(dialog, "Retry Error", status.message)
  }

  function moveFirstChild() {
    if (children().length === 1) return
    const next = children().find((x) => !!x.parentID)
    if (next) enterChild(next.id)
  }

  function moveChild(direction: -1 | 1) {
    if (children().length === 1) return

    const sessions = children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === session()?.id) - direction

    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) enterChild(sessions[next].id)
  }

  function childSessionHandler(func: () => void) {
    return () => {
      if (!session()?.parentID || dialog.stack.length > 0) return
      func()
    }
  }

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => getRevertDiffFiles(revertInfo()?.diff ?? ""))

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  // The revert marker is rendered against the message it points at. When that
  // message is older than the loaded window there is nothing to attach to, so
  // the transcript shows a compact banner at the top instead of nothing.
  const revertBeforeWindow = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return false
    return !messages().some((message) => message.id === messageID)
  })

  const transcript = createMemo(() => sync.session.transcript(route.sessionID))

  async function loadOlderMessages() {
    const current = transcript()
    if (!current.hasOlder || current.loadingOlder) return
    const box = scroll
    const before = box && !box.isDestroyed ? { height: box.scrollHeight, top: box.scrollTop } : undefined
    const atBottom = box && before ? before.top >= before.height - box.height - 1 : false
    const loaded = await sync.session.loadOlder(route.sessionID)
    if (!loaded || !box || !before) return
    // Prepending grows the content above the viewport, so hold the reader's
    // place by re-applying the recorded offset once layout has settled.
    const anchor = () => {
      if (box.isDestroyed) return
      box.scrollTo(atBottom ? box.scrollHeight : before.top + (box.scrollHeight - before.height))
    }
    setTimeout(anchor, 0)
    setTimeout(anchor, 50)
  }

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))
  return {
    route, navigate, sync, project, tuiConfig, kv, theme, promptRef, session, children, messages, permissions, questions,
    visible, disabled, pending, lastAssistant, dimensions, sidebar, setSidebar, oxSidebarOpen, setOxSidebarOpen,
    sidebarOpen, setSidebarOpen, conceal, setConceal, thinking, thinkingMode, showThinking, timestamps, setTimestamps,
    showDetails, setShowDetails, showAssistantMetadata, showScrollbar, setShowScrollbar, diffWrapMode,
    showGenericToolOutput, setShowGenericToolOutput, wide, sidebarVisible, showTimestamps, contentWidth, providers,
    scrollAcceleration, toast, sdk, editor, bind, keymap, dialog, renderer, exit, findNextVisibleMessage,
    scrollToMessage, toBottom, local, enterChild, moveFirstChild, moveChild, childSessionHandler, revertInfo,
    revertMessageID, revertDiffFiles, revertRevertedMessages, revert, revertBeforeWindow,
    transcript, loadOlderMessages,
    scroll: () => scroll,
    prompt: () => prompt,
    setScroll: (value: ScrollBoxRenderable) => {
      scroll = value
    },
  }
}
