import { createSignal, onCleanup } from "solid-js"

export type NoticeTone = "info" | "success" | "error"

/** An error is worth reading twice; a confirmation has already been seen happen. */
const NOTICE_DURATION_MS: Record<NoticeTone, number> = { info: 4_000, success: 3_000, error: 8_000 }

export function createNoticeController() {
  const [notice, setNotice] = createSignal<{ message: string; tone: NoticeTone }>()
  let timer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(timer))

  function show(message: string, tone: NoticeTone) {
    clearTimeout(timer)
    setNotice({ message, tone })
    timer = setTimeout(() => setNotice(undefined), NOTICE_DURATION_MS[tone])
  }

  async function attempt(action: () => Promise<boolean>) {
    try {
      return await action()
    } catch (cause) {
      console.error(cause)
      show(cause instanceof Error ? cause.message : String(cause), "error")
      return false
    }
  }

  return {
    notice,
    show,
    alert: (message: string) => show(message, "info"),
    /** Confirms work that already succeeded, so it names what changed. */
    succeed: (message: string) => show(message, "success"),
    attempt,
    clear() {
      clearTimeout(timer)
      setNotice(undefined)
    },
    async run(action: () => Promise<void>) {
      try {
        await action()
      } catch (cause) {
        console.error(cause)
        show(cause instanceof Error ? cause.message : String(cause), "error")
      }
    },
  }
}
