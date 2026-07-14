import { For, Show } from "solid-js"
import {
  workbenchBrowserTabLabel,
  type WorkbenchBrowserTabState,
  type WorkbenchBrowserTab,
} from "../lib/workbench"
import { Icon } from "./icon"
import { IconButton, TextInput } from "./ui"
import { BrowserHostFallback } from "./browser-host-fallback"

export function WorkbenchBrowserPanel(props: {
  tabs: WorkbenchBrowserTab[]
  activeID: string
  state?: WorkbenchBrowserTabState
  available: boolean
  url: string
  setActiveID: (id: string) => void
  closeTab: (id: string) => void
  createTab: () => void
  setURL: (value: string) => void
  navigate: () => void
  action: (action: "back" | "forward" | "reload" | "stop") => void
  captureScreenshot: () => void
  savePage: () => void
  askAgent: () => void
  openDevtools: () => void
  setHost: (element: HTMLDivElement) => void
}) {
  return (
    <div class="workbench-browser">
      <div class="workbench-browser-tabs" role="tablist" aria-label="Browser tabs">
        <For each={props.tabs}>
          {(item) => (
            <div
              role="tab"
              tabIndex={0}
              aria-selected={props.activeID === item.id}
              class="workbench-browser-tab"
              classList={{ active: props.activeID === item.id }}
              onClick={() => props.setActiveID(item.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                props.setActiveID(item.id)
              }}
            >
              <span>{workbenchBrowserTabLabel(item)}</span>
              <IconButton
                class="workbench-browser-tab-close"
                icon="x"
                label={`Close ${workbenchBrowserTabLabel(item)}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  props.closeTab(item.id)
                }}
              />
            </div>
          )}
        </For>
        <IconButton class="workbench-browser-new-tab" icon="plus" label="New browser tab" onClick={props.createTab} />
      </div>
      <div class="workbench-browser-bar">
        <IconButton icon="chevronLeft" label="Back" disabled={!props.available || !props.state?.canGoBack} onClick={() => props.action("back")} />
        <IconButton icon="chevronRight" label="Forward" disabled={!props.available || !props.state?.canGoForward} onClick={() => props.action("forward")} />
        <Show
          when={props.state?.loading}
          fallback={<IconButton icon="activity" label="Reload" disabled={!props.available} onClick={() => props.action("reload")} />}
        >
          <IconButton icon="stop" label="Stop loading" onClick={() => props.action("stop")} />
        </Show>
        <TextInput
          value={props.url}
          disabled={!props.available}
          onInput={(event) => props.setURL(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && props.navigate()}
          placeholder="Search or enter address"
        />
        <IconButton variant="primary" icon="send" label="Go" disabled={!props.available} onClick={props.navigate} />
        <IconButton icon="panel" label="Capture screenshot" disabled={!props.available} onClick={props.captureScreenshot} />
        <IconButton icon="save" label="Save page" disabled={!props.available} onClick={props.savePage} />
        <IconButton icon="send" label="Ask agent about page" disabled={!props.available} onClick={props.askAgent} />
        <IconButton icon="settings" label="Open DevTools" disabled={!props.available} onClick={props.openDevtools} />
      </div>
      <div class="workbench-browser-host" ref={props.setHost}>
        <BrowserHostFallback visible={!props.available} />
      </div>
    </div>
  )
}
