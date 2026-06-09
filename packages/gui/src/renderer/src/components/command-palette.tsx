import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

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

type PaletteCommandGroup = { title: string; start: number; commands: PaletteCommand[] }

const TUI_COMMAND_SHORTCUTS: Record<string, string> = {
  "session.list": "Ctrl+X L",
  "session.new": "Ctrl+X N",
  "opencodex.dashboard.open": "Ctrl+L",
  "opencodex.project.create": "Ctrl+X P",
  "opencodex.session.manage": "Ctrl+O",
  "opencodex.project.manage": "Ctrl+U",
  "opencodex.session.new_project": "Ctrl+N",
  "opencodex.sidebar.toggle": "Ctrl+S",
  "opencodex.sidebar.focus": "Ctrl+X F",
  "opencodex.swarm.list": "Super+Shift+D / Ctrl+X W",
  "opencodex.swarm.open": "Super+Shift+O",
  "opencodex.swarm.create": "Super+Shift+N",
  "opencodex.swarm.task": "Super+Shift+T",
  "opencodex.view.create": "Ctrl+X V",
  "model.list": "Ctrl+X M",
  "agent.list": "Ctrl+X A",
  "variant.cycle": "Ctrl+T",
  "opencode.status": "Ctrl+X S",
  "theme.switch": "Ctrl+X T",
  "app.exit": "Ctrl+C / Ctrl+D / Ctrl+X Q",
}
const COMMAND_PALETTE_PINNED_CATEGORIES = ["OpencodeX", "Swarms", "Views"]

export function CommandPaletteModal(props: { open: boolean; commands: PaletteCommand[]; close: () => void; run: (command: PaletteCommand) => void }) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let input: HTMLInputElement | undefined
  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const commands = props.commands.filter((command) => {
      if (!needle) return true
      return [command.title, command.category, command.description, command.name].filter(Boolean).join(" ").toLowerCase().includes(needle)
    })
    if (needle) return commands
    return [
      ...COMMAND_PALETTE_PINNED_CATEGORIES.flatMap((category) => commands.filter((command) => command.category === category)),
      ...commands.filter((command) => !COMMAND_PALETTE_PINNED_CATEGORIES.includes(command.category)),
    ]
  })
  const commandGroups = createMemo(() =>
    visible().reduce<PaletteCommandGroup[]>((result, command, index) => {
      const group = result.at(-1)
      if (group?.title === command.category) {
        group.commands.push(command)
        return result
      }
      return result.concat({ title: command.category, start: index, commands: [command] })
    }, []),
  )
  createEffect(() => {
    if (!props.open) return
    setQuery("")
    setSelected(0)
    requestAnimationFrame(() => input?.focus())
  })
  createEffect(() => {
    const count = visible().length
    if (selected() >= count) setSelected(Math.max(0, count - 1))
  })
  function select(offset: number) {
    const count = visible().length
    if (count === 0) return
    setSelected((current) => (current + offset + count) % count)
  }
  function submit() {
    const command = visible()[selected()]
    if (!command) return
    if (command.disabled) {
      setQuery(command.disabled)
      return
    }
    props.run(command)
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
        <section class="command-palette-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Commands</h2>
              <p>Search actions, then press Enter.</p>
            </div>
            <button type="button" aria-label="Close command palette" onClick={props.close}>{"\u00d7"}</button>
          </header>
          <input
            ref={input}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setSelected(0)
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
                submit()
              }
            }}
            placeholder="Search commands"
          />
          <div class="command-palette-list" role="listbox" aria-label="Commands">
            <For each={commandGroups()} fallback={<p class="command-palette-empty">No matching commands.</p>}>
              {(group) => (
                <section class="command-palette-group" role="group" aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <For each={group.commands}>
                    {(command, index) => {
                      const shortcut = () => command.shortcut ?? TUI_COMMAND_SHORTCUTS[command.name]
                      const detail = () => command.disabled ?? command.description
                      const commandIndex = () => group.start + index()
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected() === commandIndex()}
                          disabled={!!command.disabled}
                          classList={{ selected: selected() === commandIndex(), suggested: !!command.suggested }}
                          title={command.disabled}
                          onMouseEnter={() => setSelected(commandIndex())}
                          onClick={() => props.run(command)}
                        >
                          <strong>{command.title}</strong>
                          <Show when={detail()}>{(value) => <small>{value()}</small>}</Show>
                          <Show when={shortcut()}>{(value) => <kbd>{value()}</kbd>}</Show>
                        </button>
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
