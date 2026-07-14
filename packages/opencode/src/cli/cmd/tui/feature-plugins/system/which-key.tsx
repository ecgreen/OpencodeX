/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createSignal, Show } from "solid-js"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { WhichKeyHomeHint, WhichKeyPanel } from "./which-key-panel"
import {
  whichKeyCommand,
  whichKeyLayout,
  whichKeyToggleCommands,
  WHICH_KEY_KV_LAYOUT,
  WHICH_KEY_KV_PENDING_PREVIEW,
  WHICH_KEY_LAYER_PRIORITY,
} from "./which-key-model"

const tui: TuiPlugin = async (api) => {
  const [pinned, setPinned] = createSignal(false)
  const [mode, setMode] = createSignal(whichKeyLayout(api.kv.get(WHICH_KEY_KV_LAYOUT, "dock")))
  const [pendingPreview, setPendingPreview] = createSignal(
    api.kv.get<boolean>(WHICH_KEY_KV_PENDING_PREVIEW, false),
  )

  api.keymap.registerLayer({
    priority: WHICH_KEY_LAYER_PRIORITY,
    commands: [
      {
        name: whichKeyCommand.toggle,
        title: "Show key bindings",
        desc: "Toggle which-key overlay",
        category: "System",
        run() {
          setPinned((value) => !value)
        },
      },
      {
        name: whichKeyCommand.toggleLayout,
        title: "Toggle key bindings layout",
        desc: "Switch which-key between dock and overlay mode",
        category: "System",
        run() {
          setMode((value) => {
            const next = value === "dock" ? "overlay" : "dock"
            api.kv.set(WHICH_KEY_KV_LAYOUT, next)
            return next
          })
        },
      },
      {
        name: whichKeyCommand.togglePending,
        title: "Toggle pending key preview",
        desc: "Automatically show which-key for pending key sequences in overlay mode",
        category: "System",
        run() {
          setPendingPreview((value) => {
            api.kv.set(WHICH_KEY_KV_PENDING_PREVIEW, !value)
            return !value
          })
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("which-key.toggle", whichKeyToggleCommands),
  })

  api.slots.register({
    order: 200,
    slots: {
      home_bottom() {
        return <WhichKeyHomeHint api={api} />
      },
      app() {
        return (
          <Show when={mode() === "overlay"}>
            <WhichKeyPanel api={api} layout="overlay" mode={mode} pendingPreview={pendingPreview} pinned={pinned} />
          </Show>
        )
      },
      app_bottom() {
        return (
          <Show when={mode() === "dock"}>
            <WhichKeyPanel api={api} layout="dock" mode={mode} pendingPreview={pendingPreview} pinned={pinned} />
          </Show>
        )
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id: "which-key",
  enabled: false,
  tui,
}

export default plugin
