import { describe, expect, test } from "bun:test"
import { restoreDialogFocus, trappedDialogTabTarget } from "../src/renderer/src/lib/dialog-focus"

describe("dialog focus", () => {
  test("wraps Tab focus at both dialog boundaries", () => {
    const first = {} as HTMLElement
    const middle = {} as HTMLElement
    const last = {} as HTMLElement
    const elements = [first, middle, last]

    expect(trappedDialogTabTarget(elements, last, false)).toBe(first)
    expect(trappedDialogTabTarget(elements, first, true)).toBe(last)
    expect(trappedDialogTabTarget(elements, middle, false)).toBeUndefined()
    expect(trappedDialogTabTarget(elements, middle, true)).toBeUndefined()
  })

  test("redirects focus entering from outside to the appropriate boundary", () => {
    const first = {} as HTMLElement
    const last = {} as HTMLElement

    expect(trappedDialogTabTarget([first, last], null, false)).toBe(first)
    expect(trappedDialogTabTarget([first, last], null, true)).toBe(last)
  })

  test("restores focus only when the previous control is still connected", () => {
    const calls: FocusOptions[] = []
    const connected = {
      isConnected: true,
      focus: (options: FocusOptions) => calls.push(options),
    } as unknown as HTMLElement
    const detached = {
      isConnected: false,
      focus: () => calls.push({}),
    } as unknown as HTMLElement

    restoreDialogFocus(connected)
    restoreDialogFocus(detached)

    expect(calls).toEqual([{ preventScroll: true }])
  })
})
