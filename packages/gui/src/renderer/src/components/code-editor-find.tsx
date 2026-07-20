import type { JSX } from "solid-js"
import { IconButton, TextInput } from "./ui"
import { codeEditorFindAction } from "./code-editor-find-keys"

export function CodeEditorFind(props: {
  query: string
  count: number
  setInput: (element: HTMLInputElement) => void
  setQuery: (value: string) => void
  previous: () => void
  next: () => void
  close: () => void
}) {
  const keydown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    const action = codeEditorFindAction(event.key, event.shiftKey)
    if (!action) return
    if (action === "close") {
      event.preventDefault()
      props.close()
      return
    }
    event.preventDefault()
    if (action === "previous") props.previous()
    if (action === "next") props.next()
  }
  return (
    <div class="workbench-editor-find" role="search" aria-label="Find in file">
      <TextInput
        ref={props.setInput}
        type="search"
        size="compact"
        technical
        value={props.query}
        placeholder="Find"
        aria-label="Find in file"
        onInput={(event) => props.setQuery(event.currentTarget.value)}
        onKeyDown={keydown}
      />
      <span class="workbench-editor-find-count" aria-live="polite">{props.query ? `${props.count} matches` : ""}</span>
      <IconButton appearance="ghost" size="compact" icon="arrowUp" label="Previous match" onClick={props.previous} />
      <IconButton appearance="ghost" size="compact" icon="arrowDown" label="Next match" onClick={props.next} />
      <IconButton appearance="ghost" size="compact" icon="x" label="Close find" onClick={props.close} />
    </div>
  )
}
