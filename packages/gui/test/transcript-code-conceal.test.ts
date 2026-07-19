import { describe, expect, test } from "bun:test"
import { revealConcealedCode, syncConcealedCodeControls } from "../src/renderer/src/lib/transcript-code-conceal"

describe("transcript code concealment", () => {
  test("makes concealed blocks focusable until they are revealed", () => {
    const attributes = new Map<string, string>()
    const code = {
      tabIndex: -1,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement
    const root = { querySelectorAll: () => [code] } as unknown as HTMLElement

    syncConcealedCodeControls(root, true)
    expect(code.tabIndex).toBe(0)
    expect(code.getAttribute("role")).toBe("button")
    expect(code.getAttribute("aria-label")).toBe("Reveal concealed code block")

    revealConcealedCode(root, code, true)
    expect(code.hasAttribute("data-revealed")).toBe(true)
    expect(code.hasAttribute("tabindex")).toBe(false)
    expect(code.hasAttribute("role")).toBe(false)
  })
})
