import { describe, expect, test } from "bun:test"
import { openTabDirty, openTabIcon, openTabLabel } from "../src/renderer/src/components/session-side-open-state"
import { isBrowserInput, webInputURL } from "../src/renderer/src/components/session-side-path"
import type { OpenTab } from "../src/renderer/src/components/session-side-open-types"

describe("session workspace state", () => {
  test("identifies dirty file tabs without marking workspace surfaces", () => {
    expect(openTabDirty(tab({ kind: "file", path: "src/app.ts", text: "changed", original: "original" }))).toBe(true)
    expect(openTabDirty(tab({ kind: "file", path: "src/app.ts", text: "same", original: "same" }))).toBe(false)
    expect(openTabDirty(tab({ kind: "files", title: "Files" }))).toBe(false)
  })

  test("labels the permanent Files surface consistently", () => {
    expect(openTabLabel(tab({ kind: "files", title: "Files" }))).toBe("Files")
    expect(openTabIcon(tab({ kind: "files", title: "Files" }))).toBe("file")
  })

  test("treats address-bar searches as web searches without changing file routing", () => {
    expect(isBrowserInput("src/app.ts")).toBe(false)
    expect(webInputURL("solid js docs")).toBe("https://duckduckgo.com/?q=solid%20js%20docs")
    expect(webInputURL("localhost:3000")).toBe("http://localhost:3000")
  })
})

function tab(input: Partial<OpenTab>): OpenTab {
  return { id: "tab", input: "", title: "Tab", kind: "files", text: "", original: "", ...input }
}
