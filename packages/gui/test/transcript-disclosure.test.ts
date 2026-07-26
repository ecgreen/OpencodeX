import { describe, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

void mock.module("@opencode-ai/ui/file", () => ({ File: () => null }))
void mock.module("@opencode-ai/ui/markdown", () => ({ Markdown: () => null }))

const { autoOpenForStatus, createDisclosure, createDisclosureStore, createMountedOnce, sessionDisclosureStore, clearSessionDisclosureStore } =
  await import("../src/renderer/src/lib/disclosure")
const { thinkingPreview } = await import("../src/renderer/src/components/session-thinking")

function toggleEvent(open: boolean) {
  return { currentTarget: { open } }
}

describe("GUI transcript disclosure", () => {
  test("opens while work is live or failed and closes once it lands", () => {
    expect(autoOpenForStatus("running")).toBe(true)
    expect(autoOpenForStatus("pending")).toBe(true)
    expect(autoOpenForStatus("error")).toBe(true)
    expect(autoOpenForStatus("completed")).toBe(false)
    // Todo writes and patches are the deliverable, so they stay open.
    expect(autoOpenForStatus("completed", true)).toBe(true)
  })

  test("follows status until the reader takes over", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal("running")
      const store = createDisclosureStore()
      const disclosure = createDisclosure({ id: () => "prt_1", auto: () => autoOpenForStatus(status()), store: () => store })

      expect(disclosure.open()).toBe(true)
      setStatus("completed")
      expect(disclosure.open()).toBe(false)

      // An explicit toggle outranks the automatic value from then on.
      disclosure.handleToggle(toggleEvent(true))
      expect(disclosure.open()).toBe(true)
      setStatus("running")
      setStatus("completed")
      expect(disclosure.open()).toBe(true)
      dispose()
    })
  })

  test("ignores toggle events that merely echo the state we asked for", () => {
    createRoot((dispose) => {
      const store = createDisclosureStore()
      const disclosure = createDisclosure({ id: () => "prt_2", auto: () => true, store: () => store })

      // The browser fires `toggle` for programmatic `open` changes too; recording
      // those would freeze the row at whatever it happened to be showing.
      disclosure.handleToggle(toggleEvent(true))
      expect(store.size).toBe(0)

      disclosure.handleToggle(toggleEvent(false))
      expect(store.get("prt_2")).toBe(false)
      expect(disclosure.open()).toBe(false)
      dispose()
    })
  })

  test("latches open rather than collapsing under a reader who scrolled away", () => {
    // Effects flush once createRoot returns, so drive the state from outside it
    // exactly as a live transcript does.
    const harness = createRoot((dispose) => {
      const [status, setStatus] = createSignal("running")
      const [following, setFollowing] = createSignal(true)
      const store = createDisclosureStore()
      const disclosure = createDisclosure({
        id: () => "prt_3",
        auto: () => autoOpenForStatus(status()),
        following,
        store: () => store,
      })
      return { disclosure, setStatus, setFollowing, dispose }
    })

    expect(harness.disclosure.open()).toBe(true)
    harness.setFollowing(false)
    harness.setStatus("completed")
    expect(harness.disclosure.open()).toBe(true)
    harness.dispose()
  })

  test("collapses to a receipt when the reader is following the tail", () => {
    const harness = createRoot((dispose) => {
      const [status, setStatus] = createSignal("running")
      const store = createDisclosureStore()
      const disclosure = createDisclosure({
        id: () => "prt_4",
        auto: () => autoOpenForStatus(status()),
        following: () => true,
        store: () => store,
      })
      return { disclosure, setStatus, store, dispose }
    })

    expect(harness.disclosure.open()).toBe(true)
    harness.setStatus("completed")
    expect(harness.disclosure.open()).toBe(false)
    expect(harness.store.size).toBe(0)
    harness.dispose()
  })

  test("keeps a body mounted after its first open so collapse can animate", () => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(false)
      const mounted = createMountedOnce(open)
      expect(mounted()).toBe(false)
      setOpen(true)
      expect(mounted()).toBe(true)
      // Closing hides the body visually, but the DOM stays for the animation.
      setOpen(false)
      expect(mounted()).toBe(true)
      dispose()
    })
  })

  test("keeps one override store per session", () => {
    const first = sessionDisclosureStore("ses_a")
    first.set("prt_1", true)
    expect(sessionDisclosureStore("ses_a").get("prt_1")).toBe(true)
    expect(sessionDisclosureStore("ses_b").get("prt_1")).toBeUndefined()
    clearSessionDisclosureStore("ses_a")
    expect(sessionDisclosureStore("ses_a").get("prt_1")).toBeUndefined()
    clearSessionDisclosureStore("ses_a")
    clearSessionDisclosureStore("ses_b")
  })
})

describe("GUI thinking preview", () => {
  test("reads like a ticker while streaming and a summary once finished", () => {
    const text = "First thought\nSecond thought\nThird thought"
    expect(thinkingPreview(text, true)).toBe("Third thought")
    expect(thinkingPreview(text, false)).toBe("First thought")
  })

  test("strips markdown decoration and truncates long lines", () => {
    expect(thinkingPreview("## **Heading** with `code`", false)).toBe("Heading with code")
    expect(thinkingPreview("x".repeat(200), false)).toBe(`${"x".repeat(96)}…`)
    expect(thinkingPreview("   \n\n  ", false)).toBe("")
  })
})
