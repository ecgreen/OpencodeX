import { IconButton, TextInput } from "./ui"
import { For, Show, createMemo, createSignal } from "solid-js"
import type { PaletteCommand } from "./command-palette"
import { GUI_NAVIGATION_SHORTCUTS } from "../lib/keyboard-shortcuts"
import { trackOverlay } from "../lib/overlay-registry"

type KeyboardHelpEntry = Pick<PaletteCommand, "title" | "category" | "description" | "shortcut" | "disabled">

export function KeyboardHelpModal(props: { open: boolean; commands: PaletteCommand[]; close: () => void }) {
  const [query, setQuery] = createSignal("")
  const groups = createMemo(() => keyboardHelpGroups(props.commands, query()))
  // Parks the native browser view, which would otherwise paint over the modal.
  trackOverlay(() => props.open)
  return (
    <Show when={props.open}>
      <div
        class="dialog-backdrop keyboard-help-backdrop"
        onMouseDown={props.close}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          props.close()
        }}
      >
        <section
          class="keyboard-help-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="keyboard-help-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <div>
              <h2 id="keyboard-help-title">Keyboard Shortcuts</h2>
              <p>Commands and shortcuts available in this GUI.</p>
            </div>
            <IconButton appearance="ghost" icon="x" label="Close keyboard help" onClick={props.close} />
          </header>
          <TextInput type="search" aria-label="Filter keyboard shortcuts" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Filter shortcuts" autofocus />
          <div class="keyboard-help-list">
            <For each={groups()} fallback={<p class="command-palette-empty">No matching shortcuts.</p>}>
              {(group) => (
                <section>
                  <h3>{group.category}</h3>
                  <For each={group.commands}>
                    {(command) => (
                      <div>
                        <span>{command.title}</span>
                        <kbd>{command.shortcut ?? "—"}</kbd>
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
  const entries: KeyboardHelpEntry[] = [...commands, ...GUI_NAVIGATION_SHORTCUTS]
  return entries
    .filter((command) => !command.disabled)
    .filter((command) => command.shortcut || command.category)
    .filter((command) => {
      if (!needle) return true
      return [command.title, command.category, command.description, command.shortcut].filter(Boolean).join(" ").toLowerCase().includes(needle)
    })
    .toSorted((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title))
    .reduce<Array<{ category: string; commands: KeyboardHelpEntry[] }>>((result, command) => {
      const group = result.at(-1)
      if (group?.category === command.category) {
        group.commands.push(command)
        return result
      }
      return [...result, { category: command.category, commands: [command] }]
    }, [])
}
