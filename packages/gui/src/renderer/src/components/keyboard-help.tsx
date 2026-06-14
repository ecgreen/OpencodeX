import { For, Show, createMemo, createSignal } from "solid-js"
import type { PaletteCommand } from "./command-palette"

export function KeyboardHelpModal(props: { open: boolean; commands: PaletteCommand[]; close: () => void }) {
  const [query, setQuery] = createSignal("")
  const groups = createMemo(() => keyboardHelpGroups(props.commands, query()))
  return (
    <Show when={props.open}>
      <div class="dialog-backdrop keyboard-help-backdrop" onMouseDown={props.close}>
        <section class="keyboard-help-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Keyboard Shortcuts</h2>
              <p>Commands and shortcuts available in this GUI.</p>
            </div>
            <button type="button" aria-label="Close keyboard help" onClick={props.close}>{"\u00d7"}</button>
          </header>
          <input value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Filter shortcuts" autofocus />
          <div class="keyboard-help-list">
            <For each={groups()} fallback={<p class="command-palette-empty">No matching shortcuts.</p>}>
              {(group) => (
                <section>
                  <h3>{group.category}</h3>
                  <For each={group.commands}>
                    {(command) => (
                      <div>
                        <span>{command.title}</span>
                        <kbd>{command.shortcut ?? command.name}</kbd>
                      </div>
                    )}
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

export function keyboardHelpGroups(commands: PaletteCommand[], query: string) {
  const needle = query.trim().toLowerCase()
  return commands
    .filter((command) => !command.disabled)
    .filter((command) => command.shortcut || command.category)
    .filter((command) => {
      if (!needle) return true
      return [command.title, command.category, command.description, command.shortcut].filter(Boolean).join(" ").toLowerCase().includes(needle)
    })
    .toSorted((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title))
    .reduce<Array<{ category: string; commands: PaletteCommand[] }>>((result, command) => {
      const group = result.at(-1)
      if (group?.category === command.category) {
        group.commands.push(command)
        return result
      }
      return [...result, { category: command.category, commands: [command] }]
    }, [])
}
