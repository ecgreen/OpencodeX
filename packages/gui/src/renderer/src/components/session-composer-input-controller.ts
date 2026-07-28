import { onCleanup, onMount, type Accessor } from "solid-js"
import { composerHeightDecision } from "../lib/composer-height"
import { createAnimationFrameTask, createDebouncedTask } from "../lib/deferred-work"
import type { GuiPromptInfo } from "../lib/prompt-state"
import { clearComposerDraft, writeComposerDraft } from "../lib/session-composer-helpers"

export function createSessionComposerInputController(input: {
  sessionID: Accessor<string | undefined>
  draft: Accessor<GuiPromptInfo>
  persistent: boolean
}) {
  let textarea: HTMLTextAreaElement | undefined
  const persistence = createDebouncedTask<{ sessionID: string; draft: GuiPromptInfo }>((value) => {
    if (!value.draft.input && value.draft.parts.length === 0) {
      clearComposerDraft(value.sessionID)
      return
    }
    writeComposerDraft(value.sessionID, value.draft)
  }, 250)
  const resizeNow = () => {
    if (!textarea) return
    textarea.style.height = "auto"
    // Clamped so a long draft cannot swallow the transcript - and so clearing
    // it on submit doesn't yank hundreds of pixels back out of the viewport.
    const decision = composerHeightDecision(textarea.scrollHeight, window.innerHeight)
    textarea.style.height = `${decision.height}px`
    textarea.style.overflowY = decision.scrollable ? "auto" : "hidden"
  }
  const resize = createAnimationFrameTask(resizeNow)

  function flush() {
    if (!input.persistent) return
    const sessionID = input.sessionID()
    if (!sessionID) return
    persistence.schedule({ sessionID, draft: input.draft() })
    persistence.flush()
  }

  function setTextarea(element: HTMLTextAreaElement) {
    textarea?.removeEventListener("blur", flush)
    textarea = element
    textarea.addEventListener("blur", flush)
    resize.schedule()
  }

  function flushAll() {
    flush()
    persistence.flush()
  }

  onMount(() => {
    window.addEventListener("pagehide", flushAll)
    onCleanup(() => window.removeEventListener("pagehide", flushAll))
  })
  onCleanup(() => {
    flushAll()
    resize.cancel()
    textarea?.removeEventListener("blur", flush)
  })

  return {
    textarea: () => textarea,
    setTextarea,
    resize: resize.schedule,
    flush,
    flushPending: persistence.flush,
    schedule: persistence.schedule,
  }
}
