import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { access, readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { selectedForeground, useTheme } from "../context/theme"
import { useBindings, useCommandShortcut } from "../keymap"
import { useTuiConfig } from "../context/tui-config"
import { Locale } from "@/util/locale"
import { getScrollAcceleration } from "../util/scroll"
import { useDialog, type DialogContext } from "./dialog"

type FolderEntry = {
  kind: "parent" | "folder" | "drive"
  path: string
  title: string
  description?: string
}

type FolderRead = {
  directory: string
  entries: FolderEntry[]
  error?: string
}

export type DialogFolderPickerProps = {
  title: string
  initialDirectory?: string
  selected?: string[]
  onConfirm?: (folders: string[]) => void
  onCancel?: () => void
}

function normalizeFolder(input: string) {
  return path.resolve(input)
}

function resolveFolderInput(input: string, cwd: string) {
  const value = input.trim()
  if (!value) return undefined
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2))
  if (path.isAbsolute(value)) return value
  return path.resolve(cwd, value)
}

function isCurrentRoot(input: string) {
  return path.dirname(input) === input
}

function selectedFolders(input: Set<string>) {
  return [...input].toSorted((a, b) => a.localeCompare(b))
}

async function readWindowsDrives(current: string) {
  if (process.platform !== "win32" || !isCurrentRoot(current)) return []
  return (
    await Promise.all(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) =>
        access(`${letter}:\\`)
          .then(() => `${letter}:\\`)
          .catch(() => undefined),
      ),
    )
  )
    .filter((drive): drive is string => drive !== undefined && normalizeFolder(drive) !== current)
    .map((drive) => ({
      kind: "drive" as const,
      path: normalizeFolder(drive),
      title: drive,
      description: "drive",
    }))
}

async function readFolder(input: string): Promise<FolderRead> {
  const directory = normalizeFolder(input)
  const parent = path.dirname(directory)
  return readdir(directory, { withFileTypes: true })
    .then(async (entries) => ({
      directory,
      entries: [
        ...(isCurrentRoot(directory)
          ? await readWindowsDrives(directory)
          : [
              {
                kind: "parent" as const,
                path: parent,
                title: "../",
                description: parent,
              },
            ]),
        ...entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({
            kind: "folder" as const,
            path: path.join(directory, entry.name),
            title: entry.name,
            description: path.join(directory, entry.name),
          }))
          .toSorted((a, b) => a.title.localeCompare(b.title)),
      ],
    }))
    .catch((error: Error) => ({
      directory,
      entries: [
        ...(isCurrentRoot(directory)
          ? []
          : [
              {
                kind: "parent" as const,
                path: parent,
                title: "../",
                description: parent,
              },
            ]),
      ],
      error: error.message,
    }))
}

export function DialogFolderPicker(props: DialogFolderPickerProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const initialDirectory = normalizeFolder(props.initialDirectory ?? process.cwd())
  const [directory, setDirectory] = createSignal(initialDirectory)
  const [filter, setFilter] = createSignal("")
  const [selected, setSelected] = createSignal(new Set((props.selected ?? []).map((item) => normalizeFolder(item))))
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [result] = createResource(directory, readFolder)
  const openShortcut = useCommandShortcut("dialog.folder_picker.open")
  const toggleShortcut = useCommandShortcut("dialog.folder_picker.toggle")
  const confirmShortcut = useCommandShortcut("dialog.folder_picker.confirm")
  const parentShortcut = useCommandShortcut("dialog.folder_picker.parent")

  let input: InputRenderable
  let scroll: ScrollBoxRenderable | undefined

  const entries = createMemo(() => result()?.entries ?? [])
  const filtered = createMemo(() => {
    const needle = filter().toLowerCase()
    if (!needle) return entries()
    return entries().filter(
      (entry) => entry.title.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle),
    )
  })
  const active = createMemo(() => filtered()[selectedIndex()])
  const rows = createMemo(() => Math.max(1, Math.min(filtered().length, Math.floor(dimensions().height / 2) - 6)))
  const currentSelected = createMemo(() => selected().has(directory()))

  function rowID(entry: FolderEntry) {
    return `${entry.kind}:${entry.path}`
  }

  function moveTo(index: number, center = false) {
    const list = filtered()
    if (list.length === 0) return
    const next = Math.max(0, Math.min(index, list.length - 1))
    setSelectedIndex(next)
    if (!scroll) return
    const target = scroll.getChildren().find((child: { id?: string }) => child.id === rowID(list[next]!))
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      scroll.scrollBy(y - Math.floor(scroll.height / 2))
      return
    }
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y < 0) scroll.scrollBy(y)
  }

  function move(offset: number) {
    const list = filtered()
    if (list.length === 0) return
    moveTo((selectedIndex() + offset + list.length) % list.length)
  }

  function openEntry(entry: FolderEntry | undefined) {
    if (!entry) return
    setDirectory(entry.path)
    setFilter("")
  }

  async function typedDirectory() {
    const resolved = resolveFolderInput(filter(), directory())
    if (!resolved) return
    return stat(resolved)
      .then((item) => (item.isDirectory() ? normalizeFolder(resolved) : undefined))
      .catch(() => undefined)
  }

  async function openTypedPathOrEntry(entry: FolderEntry | undefined) {
    const typed = await typedDirectory()
    if (typed) {
      setDirectory(typed)
      setFilter("")
      return
    }
    openEntry(entry)
  }

  function goParent() {
    const next = path.dirname(directory())
    if (next === directory()) return
    setDirectory(next)
    setFilter("")
  }

  function toggleEntry(entry: FolderEntry | undefined = active()) {
    if (!entry || entry.kind === "parent") return
    setSelected((state) => {
      const next = new Set(state)
      if (next.has(entry.path)) {
        next.delete(entry.path)
        return next
      }
      next.add(entry.path)
      return next
    })
  }

  async function toggleTypedPathOrEntry() {
    const typed = await typedDirectory()
    if (typed) {
      setSelected((state) => {
        const next = new Set(state)
        if (next.has(typed)) {
          next.delete(typed)
          return next
        }
        next.add(typed)
        return next
      })
      return
    }
    toggleEntry()
  }

  async function confirm() {
    const typed = await typedDirectory()
    props.onConfirm?.(selectedFolders(typed ? new Set([...selected(), typed]) : selected()))
  }

  createEffect(() => {
    directory()
    filter()
    setSelectedIndex(0)
    setTimeout(() => scroll?.scrollTo(0), 0)
  })

  useBindings(() => ({
    commands: [
      {
        name: "dialog.folder_picker.prev",
        title: "Previous folder",
        category: "Dialog",
        run: () => move(-1),
      },
      {
        name: "dialog.folder_picker.next",
        title: "Next folder",
        category: "Dialog",
        run: () => move(1),
      },
      {
        name: "dialog.folder_picker.page_up",
        title: "Page up folders",
        category: "Dialog",
        run: () => move(-10),
      },
      {
        name: "dialog.folder_picker.page_down",
        title: "Page down folders",
        category: "Dialog",
        run: () => move(10),
      },
      {
        name: "dialog.folder_picker.home",
        title: "First folder",
        category: "Dialog",
        run: () => moveTo(0),
      },
      {
        name: "dialog.folder_picker.end",
        title: "Last folder",
        category: "Dialog",
        run: () => moveTo(filtered().length - 1),
      },
      {
        name: "dialog.folder_picker.open",
        title: "Open folder",
        category: "Dialog",
        run: () => void openTypedPathOrEntry(active()),
      },
      {
        name: "dialog.folder_picker.parent",
        title: "Go to parent folder",
        category: "Dialog",
        run: goParent,
      },
      {
        name: "dialog.folder_picker.toggle",
        title: "Toggle folder selection",
        category: "Dialog",
        run: () => void toggleTypedPathOrEntry(),
      },
      {
        name: "dialog.folder_picker.confirm",
        title: "Confirm folder selection",
        category: "Dialog",
        run: () => void confirm(),
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.folder_picker", [
      "dialog.folder_picker.prev",
      "dialog.folder_picker.next",
      "dialog.folder_picker.page_up",
      "dialog.folder_picker.page_down",
      "dialog.folder_picker.home",
      "dialog.folder_picker.end",
      "dialog.folder_picker.open",
      "dialog.folder_picker.parent",
      "dialog.folder_picker.toggle",
      "dialog.folder_picker.confirm",
    ]),
  }))

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  })

  return (
    <box gap={1} paddingBottom={1} flexGrow={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>{Locale.truncateMiddle(directory(), Math.max(1, dimensions().width - 12))}</text>
        </box>
        <box paddingTop={1}>
          <input
            onInput={setFilter}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r: InputRenderable) => {
              input = r
              input.traits = { status: "FILTER" }
            }}
            placeholder="Filter or enter folder path"
            placeholderColor={theme.textMuted}
          />
        </box>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <Show
          when={filtered().length > 0}
          fallback={
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.textMuted}>{result.loading ? "Loading folders..." : "No folders found"}</text>
            </box>
          }
        >
          <scrollbox
            paddingLeft={1}
            paddingRight={1}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
            ref={(r: ScrollBoxRenderable) => (scroll = r)}
            maxHeight={rows()}
          >
            <For each={filtered()}>
              {(entry, index) => {
                const active = createMemo(() => index() === selectedIndex())
                const checked = createMemo(() => selected().has(entry.path))
                const fg = createMemo(() => (active() ? selectedForeground(theme) : theme.text))
                return (
                  <box
                    id={rowID(entry)}
                    flexDirection="row"
                    paddingLeft={2}
                    paddingRight={3}
                    gap={1}
                    backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                    onMouseDown={() => moveTo(index())}
                    onMouseOver={() => moveTo(index())}
                    onMouseUp={() => toggleEntry(entry)}
                  >
                    <text flexShrink={0} fg={fg()}>
                      {entry.kind === "parent" ? "   " : checked() ? "[x]" : "[ ]"}
                    </text>
                    <text
                      flexGrow={1}
                      fg={fg()}
                      attributes={active() ? TextAttributes.BOLD : undefined}
                      overflow="hidden"
                      wrapMode="none"
                    >
                      {Locale.truncate(entry.title, 44)}
                    </text>
                    <Show when={entry.description}>
                      <box flexShrink={0}>
                        <text fg={active() ? selectedForeground(theme) : theme.textMuted}>
                          {Locale.truncateMiddle(entry.description!, 32)}
                        </text>
                      </box>
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>
      </box>
      <box paddingLeft={4} paddingRight={4} flexDirection="column" flexShrink={0}>
        <Show when={result()?.error}>
          <text fg={theme.error}>{Locale.truncate(result()!.error!, 80)}</text>
        </Show>
        <text fg={currentSelected() ? theme.primary : theme.textMuted}>
          {selected().size} selected{currentSelected() ? " including current folder" : ""}
        </text>
      </box>
      <box paddingLeft={4} paddingRight={2} flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" gap={2}>
          <Show when={openShortcut()}>
            <text>
              <span style={{ fg: theme.text }}>open </span>
              <span style={{ fg: theme.textMuted }}>{openShortcut()}</span>
            </text>
          </Show>
          <Show when={toggleShortcut()}>
            <text>
              <span style={{ fg: theme.text }}>select </span>
              <span style={{ fg: theme.textMuted }}>{toggleShortcut()}</span>
            </text>
          </Show>
        </box>
        <box flexDirection="row" gap={2}>
          <Show when={parentShortcut()}>
            <text>
              <span style={{ fg: theme.text }}>up </span>
              <span style={{ fg: theme.textMuted }}>{parentShortcut()}</span>
            </text>
          </Show>
          <Show when={confirmShortcut()}>
            <text>
              <span style={{ fg: theme.text }}>done </span>
              <span style={{ fg: theme.textMuted }}>{confirmShortcut()}</span>
            </text>
          </Show>
        </box>
      </box>
    </box>
  )
}

DialogFolderPicker.show = (dialog: DialogContext, title: string, options?: Omit<DialogFolderPickerProps, "title">) => {
  return new Promise<string[] | null>((resolve) => {
    let settled = false
    const settle = (value: string[] | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.replace(
      () => (
        <DialogFolderPicker
          title={title}
          {...options}
          onConfirm={(folders) => {
            settle(folders)
            dialog.clear()
          }}
          onCancel={() => settle(null)}
        />
      ),
      () => settle(null),
    )
  })
}
