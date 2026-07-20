import type { OpenTab } from "./session-side-open-types"
import type { createSessionSideTabBarController } from "./session-side-tab-bar-controller"
import { Icon } from "./icon"
import { Button, IconButton, TextInput } from "./ui"
import { SessionSideTabBar } from "./session-side-tab-bar"
import { Show } from "solid-js"
import { compactPath } from "../lib/format"

export function SessionSideOpenChrome(props: {
  sessionID: string
  tabs: OpenTab[]
  activeTab?: OpenTab
  controller: ReturnType<typeof createSessionSideTabBarController>
  changedFiles: string[]
  addGit: () => void
  addFile: () => void
  addTerminal: () => void
  addContext: () => void
  addWeb: () => void
  setWebInput: (value: string) => void
  openWebInput: () => void
  browserAction: (action: "back" | "forward" | "reload" | "stop") => void
  browserDevtools: () => void
  browserExternal: () => void
  browserScreenshot: (id: string) => Promise<string | undefined> | undefined
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  openFiles: () => void
  discardFile: () => void
  saveFile: () => void
  dirty: boolean
  readOnly: boolean
  agentBrowsing: boolean
  reloadExternal: () => void
  keepLocal: () => void
}) {
  const tab = () => props.activeTab
  return <>
    <Show when={props.tabs.length > 0}>
      <div class="session-open-chrome">
        <SessionSideTabBar controller={props.controller} addGit={props.addGit} addFile={props.addFile} addTerminal={props.addTerminal} addContext={props.addContext} addWeb={props.addWeb} changedFiles={props.changedFiles} />
        <Show when={tab()?.kind === "web"}><div class="session-open-bar">
          <IconButton icon="chevronLeft" label="Back" disabled={!tab()?.state?.canGoBack} onClick={() => props.browserAction("back")} />
          <IconButton icon="chevronRight" label="Forward" disabled={!tab()?.state?.canGoForward} onClick={() => props.browserAction("forward")} />
          <IconButton icon={tab()?.state?.loading ? "stop" : "refresh"} label={tab()?.state?.loading ? "Stop loading" : "Refresh"} onClick={() => props.browserAction(tab()?.state?.loading ? "stop" : "reload")} />
          <div class="session-open-location"><Icon name={tab()?.url?.startsWith("https://") ? "lock" : tab()?.url ? "warning" : "browser"} /><TextInput data-embedded="true" aria-label="Web address or search" value={(tab()?.input ?? "").replace(/^https:\/\//i, "")} onInput={(event) => props.setWebInput(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && props.openWebInput()} placeholder="Search or enter address" /></div>
          <IconButton icon="copy" label="Copy URL" disabled={!tab()?.url} onClick={() => void copyWebURL(tab()?.url)} />
          <IconButton icon="camera" label="Capture webpage for this session" disabled={!tab()?.url} onClick={() => void captureWebpage(props, tab())} />
          <IconButton icon="code" label="Toggle developer tools" disabled={!tab()?.url} onClick={props.browserDevtools} />
          <IconButton icon="external" label="Open in external browser" disabled={!tab()?.url} onClick={props.browserExternal} />
        </div></Show>
        <Show when={tab()?.kind === "file"}><div class="session-open-file-bar">
          <span class="session-open-file-breadcrumb"><Icon name="file" /> {tab()?.path ? compactPath(tab()?.path ?? "") : "File"}<Show when={props.readOnly}><small class="session-open-file-readonly">Read-only</small></Show></span>
          <div class="session-open-file-actions"><IconButton icon="folder-open" label="Show workspace files" onClick={props.openFiles} /><IconButton icon="undo" label="Discard unsaved changes" disabled={props.readOnly || !props.dirty} onClick={props.discardFile} /><IconButton icon="save" label="Save file" disabled={props.readOnly || !props.dirty} onClick={props.saveFile} /></div>
        </div></Show>
      </div>
    </Show>
    <Show when={tab()?.message}>{(message) => <div class="session-side-message">{message()}</div>}</Show>
    <Show when={props.agentBrowsing}><div class="session-open-agent-indicator" role="status"><Icon name="activity" />Agent browsing</div></Show>
    <Show when={tab()?.kind === "file" && tab()?.externallyChanged}><div class="session-side-conflict" role="alert"><span>The file changed on disk while this tab has unsaved edits.</span><Button appearance="ghost" onClick={props.keepLocal}>Keep mine</Button><Button appearance="solid" tone="accent" onClick={props.reloadExternal}>Reload disk version</Button></div></Show>
  </>
}

async function captureWebpage(props: Parameters<typeof SessionSideOpenChrome>[0], tab?: OpenTab) {
  if (tab?.kind !== "web") return
  const dataURL = await props.browserScreenshot(tab.id)
  if (!dataURL) return props.updateTab(tab.id, { message: "Could not capture this webpage." })
  window.dispatchEvent(new CustomEvent("opencodex:workspace-browser-capture", { detail: { sessionID: props.sessionID, dataURL, filename: `${tab.state?.title || "webpage"}.png` } }))
  props.updateTab(tab.id, { message: "Screenshot attached to the session composer." })
}

async function copyWebURL(url?: string) {
  if (url) await navigator.clipboard.writeText(url)
}
