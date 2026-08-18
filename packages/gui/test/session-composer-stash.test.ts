import { beforeEach, describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { createRoot } from "solid-js"
import { createComposerStashController } from "../src/renderer/src/components/session-composer-stash"
import { readComposerStash, textPart, writeComposerStash } from "../src/renderer/src/lib/session-composer-helpers"

/**
 * Parking a draft and getting it back. The stash lives in shared storage rather
 * than component state, so these assert on what actually landed there - the
 * helpers no-op without a `localStorage`, which is why one is installed here.
 */

const store = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
})

function harness() {
  let prompt = ""
  let flushed = 0
  let resized = 0
  const root = createRoot((dispose) => ({
    dispose,
    controller: createComposerStashController({
      draftPrompt: () => prompt,
      draftParts: () => [],
      setDraftPrompt: (value) => void (prompt = value),
      setDraftParts: () => {},
      flush: () => void (flushed += 1),
      resize: () => void (resized += 1),
    }),
  }))
  return {
    ...root,
    draft: () => prompt,
    type: (value: string) => void (prompt = value),
    counts: () => ({ flushed, resized }),
  }
}

const stashed = () => readComposerStash().map((entry) => entry.input)

describe("composer prompt stash", () => {
  beforeEach(() => {
    store.clear()
    writeComposerStash([])
  })

  test("parking a draft clears the composer and writes the entry through", () => {
    const held = harness()
    held.type("half-written thought")
    held.controller.push()
    expect(stashed()).toEqual(["half-written thought"])
    expect(held.draft()).toBe("")
    // Flushed, so draft storage does not resurrect what was just parked.
    expect(held.counts().flushed).toBe(1)
    expect(held.controller.count()).toBe(1)
    held.dispose()
  })

  test("an empty draft is not worth parking", () => {
    const held = harness()
    held.type("   ")
    held.controller.push()
    expect(stashed()).toEqual([])
    held.dispose()
  })

  test("popping restores the newest entry and removes only that one", () => {
    const held = harness()
    held.type("first")
    held.controller.push()
    held.type("second")
    held.controller.push()
    held.controller.pop()
    expect(held.draft()).toBe("second")
    expect(stashed()).toEqual(["first"])
    expect(held.counts().resized).toBe(1)
    held.dispose()
  })

  test("popping an empty stash leaves the draft alone", () => {
    const held = harness()
    held.type("still typing")
    held.controller.pop()
    expect(held.draft()).toBe("still typing")
    expect(held.counts().resized).toBe(0)
    held.dispose()
  })

  test("an entry written elsewhere is the one a pop returns", () => {
    // Another window writing the shared key is why pop re-reads storage rather
    // than trusting the entries it is already holding.
    const held = harness()
    held.type("mine")
    held.controller.push()
    writeComposerStash([...readComposerStash(), { input: "from another window", parts: [], timestamp: 1 }])
    held.controller.pop()
    expect(held.draft()).toBe("from another window")
    expect(stashed()).toEqual(["mine"])
    held.dispose()
  })
})

describe("composer message text", () => {
  const part = (text: string, flags?: { synthetic?: boolean; ignored?: boolean }) =>
    ({ id: "part-1", sessionID: "session-1", messageID: "message-1", type: "text", text, ...flags }) as Part

  test("keeps genuine user text including internal-looking markup", () => {
    expect(textPart(part("<swarm-briefing>literal</swarm-briefing>"))).toBe("<swarm-briefing>literal</swarm-briefing>")
  })

  test("hides synthetic and ignored text by provenance", () => {
    expect(textPart(part("internal briefing", { synthetic: true }))).toBe("")
    expect(textPart(part("ignored context", { ignored: true }))).toBe("")
  })
})
