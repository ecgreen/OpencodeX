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
    // Measuring requires releasing the inline height, which momentarily
    // shrinks the textarea - and grows the transcript viewport sharing its
    // column. The browser eagerly clamps the transcript's scrollTop during
    // that forced layout, and when the re-applied height matches the old one
    // (plain typing inside a tall draft) no resize event follows, so nothing
    // re-pins the transcript: it drifts up from the bottom by the composer's
    // grown height. Locking the wrapper for the measurement keeps the
    // surrounding layout still, so the scroll position is never touched.
    const wrapper = textarea.parentElement instanceof HTMLElement ? textarea.parentElement : undefined
    const wrapperHeight = wrapper ? wrapper.style.height : ""
    if (wrapper) wrapper.style.height = `${wrapper.offsetHeight}px`
    textarea.style.height = "auto"
    // Clamped so a long draft cannot swallow the transcript - and so clearing
    // it on submit doesn't yank hundreds of pixels back out of the viewport.
    const decision = composerHeightDecision(textarea.scrollHeight, window.innerHeight)
    textarea.style.height = `${decision.height}px`
    textarea.style.overflowY = decision.scrollable ? "auto" : "hidden"
    if (wrapper) wrapper.style.height = wrapperHeight
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
    resize: () => resize.schedule(),
    flush,
    flushPending: () => persistence.flush(),
    schedule: (value: { sessionID: string; draft: GuiPromptInfo }) => persistence.schedule(value),
  }
}
