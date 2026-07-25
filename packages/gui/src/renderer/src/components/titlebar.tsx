import { Button, Menu } from "./ui"
import type { JSX } from "solid-js"
import { onCleanup, onMount, Show } from "solid-js"
import { Icon } from "./icon"

export type TitlebarBreadcrumb = {
  context?: string
  current: string
  status?: string
  statusTone?: "info" | "warning" | "success" | "danger" | "neutral"
  openContext?: () => void
}

export function Titlebar(props: {
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void
  newSession: () => void
  newClaudeSession: () => void
  newProject: () => void
  newView: () => void
  newSwarm: () => void
  openDashboard: () => void
  openProjects: () => void
  openSessions: () => void
  openSwarms: () => void
  openViews: () => void
  toggleLeftSidebar: () => void
  toggleViewSidePanel?: () => void
  openCommandPalette: () => void
  openKeyboardHelp: () => void
  breadcrumb: TitlebarBreadcrumb
}) {
  let editTarget: HTMLElement | undefined
  const rememberEditTarget = (event: FocusEvent) => {
    editTarget = editableTarget(event.target) ?? editTarget
  }
  onMount(() => document.addEventListener("focusin", rememberEditTarget))
  onCleanup(() => document.removeEventListener("focusin", rememberEditTarget))

  return (
    <header class="titlebar">
      <div class="titlebar-menu" aria-label="Application menu">
        <div class="titlebar-history" aria-label="Navigation history">
          <Button appearance="ghost" class="titlebar-history-button" title="Back" aria-label="Back" disabled={!props.canGoBack} onClick={props.goBack}><Icon name="chevronLeft" /></Button>
          <Button appearance="ghost" class="titlebar-history-button" title="Forward" aria-label="Forward" disabled={!props.canGoForward} onClick={props.goForward}><Icon name="chevronRight" /></Button>
        </div>
        <TitlebarMenu label="File">
          <Menu.Item shortcut="Ctrl+N" onSelect={props.newSession}>New Session</Menu.Item>
          <Menu.Item onSelect={props.newClaudeSession}>New Claude Code Session</Menu.Item>
          <Menu.Item onSelect={props.newProject}>New Project</Menu.Item>
          <Menu.Item onSelect={props.newView}>New View</Menu.Item>
          <Menu.Item onSelect={props.newSwarm}>New Swarm</Menu.Item>
        </TitlebarMenu>
        <TitlebarMenu label="Edit">
          <Menu.Item shortcut="Ctrl+X" onSelect={() => runEditAction("cut", editTarget)}>Cut</Menu.Item>
          <Menu.Item shortcut="Ctrl+C" onSelect={() => runEditAction("copy", editTarget)}>Copy</Menu.Item>
          <Menu.Item shortcut="Ctrl+V" onSelect={() => runEditAction("paste", editTarget)}>Paste</Menu.Item>
          <Menu.Separator />
          <Menu.Item shortcut="Ctrl+K" onSelect={props.openCommandPalette}>Command Palette</Menu.Item>
        </TitlebarMenu>
        <TitlebarMenu label="View">
          <Menu.Item onSelect={props.openDashboard}>Dashboard</Menu.Item>
          <Menu.Item onSelect={props.openProjects}>Projects</Menu.Item>
          <Menu.Item onSelect={props.openSessions}>Sessions</Menu.Item>
          <Menu.Item onSelect={props.openSwarms}>Swarms</Menu.Item>
          <Menu.Item onSelect={props.openViews}>Views</Menu.Item>
          <Menu.Separator />
          <Menu.Item shortcut="Ctrl+B" onSelect={props.toggleLeftSidebar}>Toggle Left Sidebar</Menu.Item>
          <Menu.Item disabled={!props.toggleViewSidePanel} onSelect={() => props.toggleViewSidePanel?.()}>Toggle View Side Panel</Menu.Item>
        </TitlebarMenu>
        <TitlebarMenu label="Help">
          <Menu.Item shortcut="Ctrl+?" onSelect={props.openKeyboardHelp}>Keyboard Shortcuts</Menu.Item>
        </TitlebarMenu>
      </div>
      <div class="titlebar-drag">
        <nav class="titlebar-breadcrumb" aria-label="Current location">
          <Show when={props.breadcrumb.context}>
            {(context) => (
              <>
                <Show
                  when={props.breadcrumb.openContext}
                  fallback={<span class="titlebar-breadcrumb-context">{context()}</span>}
                >
                  {(openContext) => (
                    <Button appearance="ghost" class="titlebar-breadcrumb-context" onClick={openContext()}>
                      {context()}
                    </Button>
                  )}
                </Show>
                <Icon name="chevronRight" class="titlebar-breadcrumb-separator" />
              </>
            )}
          </Show>
          <span class="titlebar-breadcrumb-current">{props.breadcrumb.current}</span>
          <Show when={props.breadcrumb.status}>
            {(status) => (
              <span class="titlebar-breadcrumb-status" data-tone={props.breadcrumb.statusTone ?? "neutral"}>
                {status()}
              </span>
            )}
          </Show>
        </nav>
      </div>
      <div class="window-controls">
        <Button appearance="ghost" aria-label="Minimize" onClick={() => void window.opencodex?.window("minimize")}><Icon name="minus" /></Button>
        <Button appearance="ghost" aria-label="Maximize" onClick={() => void window.opencodex?.window("maximize")}><Icon name="stop" /></Button>
        <Button appearance="ghost" aria-label="Close" class="close" onClick={() => void window.opencodex?.window("close")}><Icon name="x" /></Button>
      </div>
    </header>
  )
}

function runEditAction(action: "cut" | "copy" | "paste", target?: HTMLElement) {
  setTimeout(() => {
    target?.focus()
    if (window.opencodex?.edit) {
      void window.opencodex.edit(action)
      return
    }
    document.execCommand(action)
  })
}

function editableTarget(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(target.type)) return target
  if (target instanceof HTMLElement && target.isContentEditable) return target
  return undefined
}

function TitlebarMenu(props: { label: string; children: JSX.Element }) {
  return (
    <Menu>
      <Menu.Trigger class="titlebar-menu-trigger">{props.label}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="titlebar-menu-content">{props.children}</Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
