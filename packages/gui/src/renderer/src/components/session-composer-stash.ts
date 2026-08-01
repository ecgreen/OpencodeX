import { createSignal, onCleanup, onMount } from "solid-js"
import { pushPromptStash, type GuiPromptStashEntry } from "../lib/prompt-state"
import { readComposerStash, subscribeComposerStash, writeComposerStash } from "../lib/session-composer-helpers"

/**
 * The composer's prompt stash: park a draft, get it back later.
 *
 * The stash is shared storage rather than component state - another window can
 * push to it - so every mutation writes through and the signal is kept in step
 * by the subscription, not by the caller.
 */
export function createComposerStashController(input: {
  draftPrompt: () => string
  draftParts: () => GuiPromptStashEntry["parts"]
  setDraftPrompt: (value: string) => void
  setDraftParts: (value: GuiPromptStashEntry["parts"]) => void
  /** Commits the draft to storage, so a stash does not leave the old one behind. */
  flush: () => void
  resize: () => void
}) {
  const [stash, setStash] = createSignal<GuiPromptStashEntry[]>(readComposerStash())
  onMount(() => onCleanup(subscribeComposerStash(setStash)))

  function commit(next: GuiPromptStashEntry[]) {
    setStash(next)
    writeComposerStash(next)
  }

  return {
    count: () => stash().length,
    push: () => {
      commit(pushPromptStash(readComposerStash(), { input: input.draftPrompt(), parts: input.draftParts() }))
      input.setDraftPrompt("")
      input.setDraftParts([])
      input.flush()
    },
    pop: () => {
      // Re-read rather than trusting the signal: the entry being restored may
      // have been pushed by a different window since the last notification.
      const entries = readComposerStash()
      const entry = entries.at(-1)
      if (!entry) return
      commit(entries.slice(0, -1))
      input.setDraftPrompt(entry.input)
      input.setDraftParts(entry.parts)
      input.resize()
    },
  }
}
