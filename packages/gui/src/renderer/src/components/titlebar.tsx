import { Button } from "./ui"
import type { JSX } from "solid-js"
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "./icon"

export function Titlebar(props: {
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void
  newSession: () => void
  newProject: () => void
  newView: () => void
  newSwarm: () => void
  openDashboard: () => void
  openProjects: () => void
  openSessions: () => void
  openSwarms: () => void
  openViews: () => void
  openWorkbench: () => void
  toggleLeftSidebar: () => void
  toggleViewSidePanel?: () => void
  openCommandPalette: () => void
  openKeyboardHelp: () => void
}) {
  const [openMenu, setOpenMenu] = createSignal("")

  onMount(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".titlebar-menu, .titlebar-menu-popover")) return
      setOpenMenu("")
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu("")
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    })
  })

  return (
    <header class="titlebar">
      <div
        class="titlebar-menu"
        aria-label="Application menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="titlebar-history" aria-label="Navigation history">
          <Button appearance="ghost" class="titlebar-history-button" title="Back" aria-label="Back" disabled={!props.canGoBack} onClick={props.goBack}><Icon name="chevronLeft" /></Button>
          <Button appearance="ghost" class="titlebar-history-button" title="Forward" aria-label="Forward" disabled={!props.canGoForward} onClick={props.goForward}><Icon name="chevronRight" /></Button>
        </div>
        <TitlebarMenu label="File" open={openMenu() === "File"} toggle={() => setOpenMenu(openMenu() === "File" ? "" : "File")}>
          <TitlebarMenuButton label="New Session" shortcut="Ctrl+N" action={props.newSession} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="New Project" action={props.newProject} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="New View" action={props.newView} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="New Swarm" action={props.newSwarm} close={() => setOpenMenu("")} />
        </TitlebarMenu>
        <TitlebarMenu label="Edit" open={openMenu() === "Edit"} toggle={() => setOpenMenu(openMenu() === "Edit" ? "" : "Edit")}>
          <TitlebarMenuButton label="Cut" shortcut="Ctrl+X" action={() => runEditAction("cut")} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Copy" shortcut="Ctrl+C" action={() => runEditAction("copy")} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Paste" shortcut="Ctrl+V" action={() => runEditAction("paste")} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Command Palette" shortcut="Ctrl+K" action={props.openCommandPalette} close={() => setOpenMenu("")} />
        </TitlebarMenu>
        <TitlebarMenu label="View" open={openMenu() === "View"} toggle={() => setOpenMenu(openMenu() === "View" ? "" : "View")}>
          <TitlebarMenuButton label="Dashboard" action={props.openDashboard} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Projects" action={props.openProjects} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Sessions" action={props.openSessions} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Swarms" action={props.openSwarms} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Views" action={props.openViews} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Browser / Workbench" action={props.openWorkbench} close={() => setOpenMenu("")} />
          <TitlebarMenuDivider />
          <TitlebarMenuButton label="Toggle Left Sidebar" shortcut="Ctrl+B" action={props.toggleLeftSidebar} close={() => setOpenMenu("")} />
          <TitlebarMenuButton label="Toggle View Side Panel" disabled={!props.toggleViewSidePanel} action={() => props.toggleViewSidePanel?.()} close={() => setOpenMenu("")} />
        </TitlebarMenu>
        <TitlebarMenu label="Help" open={openMenu() === "Help"} toggle={() => setOpenMenu(openMenu() === "Help" ? "" : "Help")}>
          <TitlebarMenuButton label="Keyboard Shortcuts" action={props.openKeyboardHelp} close={() => setOpenMenu("")} />
        </TitlebarMenu>
      </div>
      <div class="titlebar-drag" />
      <div class="window-controls">
        <Button appearance="ghost" aria-label="Minimize" onClick={() => void window.opencodex?.window("minimize")}>-</Button>
        <Button appearance="ghost" aria-label="Maximize" onClick={() => void window.opencodex?.window("maximize")}>{"\u25a1"}</Button>
        <Button appearance="ghost" aria-label="Close" class="close" onClick={() => void window.opencodex?.window("close")}>{"\u00d7"}</Button>
      </div>
    </header>
  )
}

function runEditAction(action: "cut" | "copy" | "paste") {
  if (window.opencodex?.edit) {
    void window.opencodex.edit(action)
    return
  }
  document.execCommand(action)
}

function TitlebarMenu(props: { label: string; open: boolean; toggle: () => void; children: JSX.Element }) {
  let summary: HTMLElement | undefined
  const [position, setPosition] = createSignal({ left: 0, top: 0 })

  function updatePosition() {
    const rect = summary?.getBoundingClientRect()
    if (!rect) return
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)), top: rect.bottom + 7 })
  }

  createEffect(() => {
    if (!props.open) return
    updatePosition()
  })

  return (
    <details class="titlebar-menu-group" open={props.open}>
      <summary
        ref={summary}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          updatePosition()
          props.toggle()
        }}
      >{props.label}</summary>
      <Show when={props.open}>
        <Portal>
          <div
            class="titlebar-menu-popover"
            style={{ left: `${position().left}px`, top: `${position().top}px` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {props.children}
          </div>
        </Portal>
      </Show>
    </details>
  )
}

function TitlebarMenuButton(props: { label: string; shortcut?: string; disabled?: boolean; action: () => void; close: () => void }) {
  return (
    <Button appearance="ghost"
      class="titlebar-menu-item"
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        props.action()
        props.close()
      }}
    >
      <span>{props.label}</span>
      <Show when={props.shortcut}><kbd>{props.shortcut}</kbd></Show>
    </Button>
  )
}

function TitlebarMenuDivider() {
  return <div class="titlebar-menu-divider" role="separator" />
}
