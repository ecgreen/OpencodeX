import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { TextInput, Button, IconButton } from "./ui"
import { formatRelative, title } from "../lib/format"
import { rankByScore } from "../lib/palette-search"

export type PaletteCommand = {
  name: string
  title: string
  category: string
  description?: string
  shortcut?: string
  suggested?: boolean
  disabled?: string
  run: () => void | Promise<void>
}

export type PaletteTarget = {
  kind: "session" | "project" | "view"
  id: string
  title: string
  subtitle?: string
  status?: string
  statusTone?: "info" | "warning" | "success" | "danger" | "neutral"
  time?: number
  run: () => void
}

export type PaletteSelection = { kind: "command"; command: PaletteCommand } | { kind: "target"; target: PaletteTarget }

type PaletteRow = { type: "command"; command: PaletteCommand } | { type: "target"; target: PaletteTarget }

type PaletteRowGroup = { title: string; start: number; rows: PaletteRow[] }

const COMMAND_PALETTE_PINNED_CATEGORIES = ["OpencodeX", "Swarms", "Views"]
const RECENT_TARGET_LIMIT = 5
const JUMP_TARGET_LIMIT = 8

export function CommandPaletteModal(props: {
  open: boolean
  commands: PaletteCommand[]
  targets: PaletteTarget[]
  recents: PaletteTarget[]
  close: () => void
  run: (selection: PaletteSelection) => void
}) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  const [notice, setNotice] = createSignal("")
  let input: HTMLInputElement | undefined

  const groups = createMemo(() => {
    const needle = query().trim()
    if (!needle) {
      const recents = props.recents.slice(0, RECENT_TARGET_LIMIT).map((target): PaletteRow => ({ type: "target", target }))
      const ordered = [
        ...COMMAND_PALETTE_PINNED_CATEGORIES.flatMap((category) => props.commands.filter((command) => command.category === category)),
        ...props.commands.filter((command) => !COMMAND_PALETTE_PINNED_CATEGORIES.includes(command.category)),
      ]
      return withRowStarts([
        ...(recents.length > 0 ? [{ title: "Recent sessions", start: 0, rows: recents }] : []),
        ...commandRowGroups(ordered),
      ])
    }
    const targets = rankByScore(needle, props.targets, (target) => [target.title, target.subtitle, target.status]).slice(0, JUMP_TARGET_LIMIT)
    const commands = rankByScore(needle, props.commands, (command) => [command.title, command.category, command.description, command.name])
    return withRowStarts([
      ...(targets.length > 0 ? [{ title: "Jump to", start: 0, rows: targets.map((target): PaletteRow => ({ type: "target", target })) }] : []),
      ...commandRowGroups(commands),
    ])
  })
  const rows = createMemo(() => groups().flatMap((group) => group.rows))

  createEffect(() => {
    if (!props.open) return
    setQuery("")
    setSelected(0)
    setNotice("")
    requestAnimationFrame(() => input?.focus())
  })
  createEffect(() => {
    const count = rows().length
    if (selected() >= count) setSelected(Math.max(0, count - 1))
  })
  function select(offset: number) {
    const count = rows().length
    if (count === 0) return
    setSelected((current) => (current + offset + count) % count)
  }
  function activate(row: PaletteRow) {
    if (row.type === "command" && row.command.disabled) {
      setNotice(row.command.disabled)
      return
    }
    props.run(row.type === "command" ? { kind: "command", command: row.command } : { kind: "target", target: row.target })
  }
  return (
    <Show when={props.open}>
      <div
        class="dialog-backdrop command-palette-backdrop"
        onMouseDown={props.close}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          props.close()
        }}
      >
        <section
          class="command-palette-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <div>
              <h2 id="command-palette-title">Commands</h2>
              <p>Jump to a session, project, or view — or run an action.</p>
            </div>
            <IconButton icon="x" label="Close command palette" onClick={props.close} />
          </header>
          <TextInput
            ref={input}
            type="search"
            aria-label="Search commands, sessions, projects, and views"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setSelected(0)
              setNotice("")
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                props.close()
                return
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                select(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                select(-1)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                const row = rows()[selected()]
                if (row) activate(row)
              }
            }}
            placeholder="Search or jump to…"
            aria-activedescendant={rows()[selected()] ? `command-palette-row-${selected()}` : undefined}
          />
          <Show when={notice()}>
            <p class="command-palette-notice" role="alert">{notice()}</p>
          </Show>
          <div class="command-palette-list" role="listbox" aria-label="Commands">
            <For each={groups()} fallback={<p class="command-palette-empty">No matching commands.</p>}>
              {(group) => (
                <section class="command-palette-group" role="group" aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <For each={group.rows}>
                    {(row, index) => {
                      const rowIndex = () => group.start + index()
                      if (row.type === "target")
                        return (
                          <Button appearance="ghost"
                            id={`command-palette-row-${rowIndex()}`}
                            type="button"
                            role="option"
                            aria-selected={selected() === rowIndex()}
                            classList={{ selected: selected() === rowIndex() }}
                            onMouseEnter={() => setSelected(rowIndex())}
                            onClick={() => activate(row)}
                          >
                            <strong>{title(row.target.title)}</strong>
                            <Show when={row.target.subtitle}>{(value) => <small>{value()}</small>}</Show>
                            <Show when={row.target.status}>{(value) => <small class="command-palette-target-status" data-tone={row.target.statusTone ?? "neutral"}>{value()}</small>}</Show>
                            <Show when={row.target.time}>{(value) => <small class="command-palette-target-time">{formatRelative(value())}</small>}</Show>
                          </Button>
                        )
                      const command = row.command
                      return (
                        <Button appearance="ghost"
                          id={`command-palette-row-${rowIndex()}`}
                          type="button"
                          role="option"
                          aria-selected={selected() === rowIndex()}
                          disabled={!!command.disabled}
                          classList={{ selected: selected() === rowIndex(), suggested: !!command.suggested }}
                          title={command.disabled}
                          onMouseEnter={() => setSelected(rowIndex())}
                          onClick={() => activate(row)}
                        >
                          <strong>{command.title}</strong>
                          <Show when={command.disabled ?? command.description}>{(value) => <small>{value()}</small>}</Show>
                          <Show when={command.shortcut}>{(value) => <kbd>{value()}</kbd>}</Show>
                        </Button>
                      )
                    }}
                  </For>
                </section>
              )}
            </For>
          </div>
        </section>
      </div>
    </Show>
  )
}

function commandRowGroups(commands: PaletteCommand[]): PaletteRowGroup[] {
  return commands.reduce<PaletteRowGroup[]>((result, command) => {
    const group = result.at(-1)
    if (group?.title === command.category) {
      group.rows.push({ type: "command", command })
      return result
    }
    return result.concat({ title: command.category, start: 0, rows: [{ type: "command", command }] })
  }, [])
}

function withRowStarts(groups: PaletteRowGroup[]): PaletteRowGroup[] {
  let index = 0
  return groups.map((group) => {
    const start = index
    index += group.rows.length
    return { ...group, start }
  })
}
