import { For, Show, createEffect, onCleanup } from "solid-js"
import { TextInput, Button } from "./ui"
import type { SwitcherPreviewRow, SwitcherSessionItem } from "../controllers/session-switcher-controller"
import { formatRelative, title } from "../lib/format"
import type { GuiSnapshot } from "../lib/store"
import { projectNameForSession } from "../lib/project-name"
import { deriveSessionStatus, sessionStatusLabel, sessionStatusTone } from "../lib/session-status"
import { dialogFocusableElements, restoreDialogFocus, trappedDialogTabTarget } from "../lib/dialog-focus"

export function SessionSwitcherOverlay(props: {
  open: boolean
  cursor: number
  query: string
  sticky: boolean
  rows: SwitcherSessionItem[]
  snapshot: GuiSnapshot | undefined
  terminalStatus: (item: Extract<SwitcherSessionItem, { kind: "terminal" }>) => string
  preview: (sessionID: string) => SwitcherPreviewRow[]
  filter: (value: string) => void
  move: (offset: 1 | -1) => void
  select: (index: number) => void
  commit: (index?: number) => void
  cancel: () => void
}) {
  let input: HTMLInputElement | undefined
  let dialog: HTMLElement | undefined
  let previousFocus: HTMLElement | undefined

  createEffect(() => {
    if (!props.open) {
      restoreDialogFocus(previousFocus)
      previousFocus = undefined
      return
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const focusInput = () => input?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(focusInput)
    const containFocus = (event: FocusEvent) => {
      if (dialog?.contains(event.target as Node)) return
      focusInput()
    }
    /*
     * focusin only fires when something new takes focus, so it cannot see the
     * case where a row is removed mid-keystroke - filtering re-renders the
     * list - and focus falls back to <body>. Nothing re-arms, and the dialog
     * is left containing no focus at all. Watch the departure too, and pull
     * focus back once the browser has settled on its replacement.
     */
    const releaseFocus = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next && dialog?.contains(next)) return
      queueMicrotask(() => {
        if (!props.open || !dialog) return
        if (dialog.contains(document.activeElement)) return
        focusInput()
      })
    }
    document.addEventListener("focusin", containFocus)
    document.addEventListener("focusout", releaseFocus)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      document.removeEventListener("focusin", containFocus)
      document.removeEventListener("focusout", releaseFocus)
    })
  })

  const status = (item: SwitcherSessionItem) => item.kind === "terminal"
    ? props.terminalStatus(item)
    : sessionStatusLabel(deriveSessionStatus(props.snapshot, item.session))
  const statusTone = (item: SwitcherSessionItem) => item.kind === "terminal"
    ? (status(item) === "running" ? "success" : status(item) === "error" || status(item) === "missing-cli" ? "danger" : "neutral")
    : sessionStatusTone(deriveSessionStatus(props.snapshot, item.session))
  const highlighted = () => props.rows[props.cursor]

  return (
    <Show when={props.open}>
      <div
        class="session-switcher-backdrop"
        onMouseDown={(event) => {
          event.preventDefault()
          props.cancel()
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const target = dialog
              ? trappedDialogTabTarget(dialogFocusableElements(dialog), document.activeElement, event.shiftKey)
              : undefined
            if (!target) return
            event.preventDefault()
            event.stopPropagation()
            target.focus({ preventScroll: true })
            return
          }
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          props.cancel()
        }}
      >
        <section
          ref={dialog}
          class="session-switcher"
          role="dialog"
          aria-modal="true"
          aria-label="Switch session"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <TextInput
            ref={input}
            type="search"
            aria-label="Filter recent sessions"
            value={props.query}
            onInput={(event) => props.filter(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                props.cancel()
                return
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                props.move(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                props.move(-1)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                props.commit()
              }
            }}
            placeholder="Filter sessions…"
            aria-activedescendant={highlighted() ? `session-switcher-row-${props.cursor}` : undefined}
          />
          <div class="session-switcher-body">
            <div class="session-switcher-list" role="listbox" aria-label="Recent sessions">
              <For each={props.rows} fallback={<p class="command-palette-empty">No recent sessions yet.</p>}>
                {(session, index) => (
                  <Button appearance="ghost"
                    id={`session-switcher-row-${index()}`}
                    type="button"
                    role="option"
                    aria-selected={props.cursor === index()}
                    classList={{ selected: props.cursor === index() }}
                    onMouseEnter={() => props.select(index())}
                    onClick={() => props.commit(index())}
                  >
                    <span class="session-switcher-row-main">
                      <strong>{title(session.title)}</strong>
                      <small>{projectNameForSession(props.snapshot?.projects ?? [], session) ?? "No project"} · {formatRelative(session.time.updated)}</small>
                    </span>
                    <span class="session-switcher-row-meta">
                      <Show when={!props.query && index() < 9}>
                        <kbd>Alt+{index() + 1}</kbd>
                      </Show>
                      <small data-tone={statusTone(session)}>{status(session)}</small>
                    </span>
                  </Button>
                )}
              </For>
            </div>
            <aside class="session-switcher-preview" aria-label="Session preview">
              <Show
                when={highlighted()}
                fallback={<p class="session-switcher-preview-empty">No session selected.</p>}
              >
                {(session) => (
                  <>
                    <header>
                      <strong>{title(session().title)}</strong>
                      <small data-tone={statusTone(session())}>{status(session())}</small>
                    </header>
                    <Show
                      when={session().kind !== "terminal"}
                      fallback={
                        <p class="session-switcher-preview-empty">
                          Claude Code owns this session's transcript. Open it in OpencodeX Desktop to continue.
                        </p>
                      }
                    >
                      <Show
                        when={props.preview(session().id).length > 0}
                        fallback={<p class="session-switcher-preview-empty">Open this session once to preview its transcript.</p>}
                      >
                        <For each={props.preview(session().id)}>
                          {(row) => (
                            <p class={`session-switcher-preview-row ${row.role}`}>
                              <strong>{row.role === "user" ? "You" : "Assistant"}</strong>
                              <span>{row.text}</span>
                            </p>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </>
                )}
              </Show>
            </aside>
          </div>
          <footer class="session-switcher-hints">
            <span><kbd>Ctrl+Tab</kbd> {props.sticky ? "search mode" : "cycle"}</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </footer>
        </section>
      </div>
    </Show>
  )
}
