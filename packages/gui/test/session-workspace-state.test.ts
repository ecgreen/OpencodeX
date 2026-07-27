import { describe, expect, test } from "bun:test"
import {
  openTabDirty,
  openTabFileIdentity,
  openTabIcon,
  openTabLabel,
  restoreOpenPanelState,
  saveOpenPanelState,
} from "../src/renderer/src/components/session-side-open-state"
import { isBrowserInput, webInputURL } from "../src/renderer/src/components/session-side-path"
import type { OpenTab } from "../src/renderer/src/components/session-side-open-types"

describe("session workspace state", () => {
  test("identifies dirty file tabs without marking workspace surfaces", () => {
    expect(openTabDirty(tab({ kind: "file", path: "src/app.ts", text: "changed", original: "original" }))).toBe(true)
    expect(openTabDirty(tab({ kind: "file", path: "src/app.ts", text: "same", original: "same" }))).toBe(false)
    expect(openTabDirty(tab({ kind: "file", path: "index.d.ts", text: "changed", original: "original", readOnly: true }))).toBe(false)
    expect(openTabDirty(tab({ kind: "files", title: "Files" }))).toBe(false)
  })

  test("keys file tabs by workspace route, dependency root, and path", () => {
    expect(openTabFileIdentity({ directory: "C:\\repo", path: "src/app.ts" }))
      .toBe(openTabFileIdentity({ directory: "C:/repo", root: "C:/repo", path: "./src/app.ts" }))
    expect(openTabFileIdentity({ directory: "C:/repo", root: "C:/deps/pkg-a", path: "index.d.ts" }))
      .not.toBe(openTabFileIdentity({ directory: "C:/repo", root: "C:/deps/pkg-b", path: "index.d.ts" }))
    expect(openTabFileIdentity({ directory: "C:/other", root: "C:/deps/pkg-a", path: "index.d.ts" }))
      .not.toBe(openTabFileIdentity({ directory: "C:/repo", root: "C:/deps/pkg-a", path: "index.d.ts" }))
  })

  test("restores dependency addressing and read-only metadata", () => {
    const dependency = tab({
      id: "dependency",
      kind: "file",
      path: "index.d.ts",
      directory: "C:/repo",
      root: "C:/cache/pkg",
      readOnly: true,
      text: "declare const value: string",
      original: "declare const value: string",
    })
    saveOpenPanelState("pending:dependency-state-test", [dependency], dependency.id)

    expect(restoreOpenPanelState("pending:dependency-state-test").tabs[0]).toMatchObject({
      path: "index.d.ts",
      directory: "C:/repo",
      root: "C:/cache/pkg",
      readOnly: true,
    })
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
