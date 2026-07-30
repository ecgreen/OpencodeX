import type { Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { readWorkbenchFile } from "../lib/session-api"
import type { OpenTab } from "./session-side-open-types"

/**
 * Reconciles an open file against the version on disk.
 *
 * A file that changed underneath an untouched buffer is simply reloaded. When
 * the buffer has edits, neither version can be thrown away silently, so the tab
 * is flagged and the reader chooses: take the disk version, or keep theirs and
 * overwrite on the next save.
 */
export function createSessionSideFileExternal(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  tabs: Accessor<OpenTab[]>
  activeTab: Accessor<OpenTab | undefined>
  updateTab: (id: string, patch: Partial<OpenTab>) => void
}) {
  async function check(id: string, signal?: AbortSignal) {
    const gui = input.gui()
    const started = input.tabs().find((item) => item.id === id)
    if (
      !gui ||
      started?.kind !== "file" ||
      !started.path ||
      started.content?.type !== "text" ||
      started.fileMode !== "editable" ||
      started.externallyChanged ||
      started.readOnly
    )
      return
    const file = await readWorkbenchFile(
      gui,
      started.path,
      started.directory || input.directory(),
      signal,
      started.root,
    ).catch(() => undefined)
    const content = file?.content
    const tab = input.tabs().find((item) => item.id === id)
    if (content?.type !== "text" || tab?.kind !== "file" || tab.path !== started.path || content.content === tab.original)
      return
    if (tab.text === tab.original) {
      input.updateTab(id, {
        content,
        text: content.content,
        original: content.content,
        message: "Reloaded after an external change.",
      })
      return
    }
    input.updateTab(id, {
      externalText: content.content,
      externallyChanged: true,
      message: "This file changed on disk while you have unsaved edits.",
    })
  }

  function reload() {
    const tab = input.activeTab()
    if (tab?.kind !== "file" || tab.externalText === undefined) return
    const content = tab.content?.type === "text" ? { ...tab.content, content: tab.externalText } : tab.content
    input.updateTab(tab.id, {
      content,
      text: tab.externalText,
      original: tab.externalText,
      externalText: undefined,
      externallyChanged: false,
      message: "Reloaded the version on disk.",
    })
  }

  function keepLocal() {
    const tab = input.activeTab()
    if (tab?.kind !== "file" || tab.externalText === undefined) return
    input.updateTab(tab.id, {
      original: tab.externalText,
      externalText: undefined,
      externallyChanged: false,
      message: "Keeping your buffer. Saving will replace the version on disk.",
    })
  }

  return { check, reload, keepLocal }
}
