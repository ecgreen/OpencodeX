import { createSignal, onCleanup } from "solid-js"

export function createNoticeController() {
  const [notice, setNotice] = createSignal<{ message: string; tone: "info" | "error" }>()
  let timer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(timer))

  function show(message: string, tone: "info" | "error") {
    clearTimeout(timer)
    setNotice({ message, tone })
    timer = setTimeout(() => setNotice(undefined), tone === "error" ? 8_000 : 4_000)
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
    alert: (message: string) => show(message, "info"),
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
