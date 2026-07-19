import { Button, IconButton } from "./ui"
import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "./icon"
import { OPEN_PANEL_OVERFLOW_VISIBLE_ROWS, type OpenTab } from "./session-side-open-types"
import { openTabIcon, openTabLabel } from "./session-side-open-state"
import { createSessionSideTabBarController } from "./session-side-tab-bar-controller"

export function SessionSideTabBar(props: {
  controller: ReturnType<typeof createSessionSideTabBarController>
  addGit: () => void
  addFile: () => void
  addTerminal: () => void
  addContext: () => void
  addWeb: () => void
}) {
  const controller = props.controller
  return (
    <div class="session-open-tabs" ref={controller.setBar}>
      <For each={controller.rows()}>
        {(row) => row.type === "placeholder" ? (
          <div class="session-open-tab-placeholder" data-open-tab-row-id="placeholder" style={{ width: `${row.width}px` }} />
        ) : (
          <div class="session-open-tab-shell" data-open-tab-row-id={row.tab.id}>
            <Button appearance="ghost"
              type="button"
              class="session-open-tab-button"
              role="tab"
              data-open-tab-id={row.tab.id}
              aria-selected={controller.activeID() === row.tab.id}
              classList={{ active: controller.activeID() === row.tab.id, dragging: controller.dragID() === row.tab.id }}
              onPointerDown={(event) => {
                if (row.tab.id !== controller.activeID()) controller.hideWebTabs()
                controller.startDrag(event, row.tab)
              }}
              onClick={() => controller.select(row.tab.id)}
            >
              <Icon name={openTabIcon(row.tab)} />
              <span>{controller.label(row.tab)}</span>
            </Button>
            <IconButton
              appearance="ghost"
              size="compact"
              icon="x"
              class="session-open-tab-close"
              label={`Close ${controller.label(row.tab)}`}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (row.tab.kind === "web") controller.hideWebTabs()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                controller.closeTab(row.tab.id)
              }}
            />
          </div>
        )}
      </For>
      <Show when={controller.overflowTabs().length > 0}>
        <div class="session-open-overflow-tab-menu">
          <Button appearance="ghost"
            type="button"
            class="session-open-menu-trigger session-open-overflow-trigger"
            ref={controller.setOverflowMenuAnchor}
            aria-label={`${controller.overflowTabs().length} hidden tabs`}
            title="Open tabs"
            aria-expanded={controller.overflowMenuOpen()}
            onClick={controller.toggleOverflowMenu}
          >
            <Icon name="more" />
            <span>{controller.overflowTabs().length} tabs</span>
          </Button>
        </div>
        <Show when={controller.overflowMenuOpen()}>
          <Portal>
            <div
              class="session-open-popup-menu session-open-overflow-tab-panel"
              classList={{ scrollable: controller.overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS }}
              ref={controller.setOverflowMenuPanel}
              style={controller.overflowMenuStyle()}
            >
              <For each={controller.overflowTabs()}>
                {(tab) => (
                  <Button appearance="ghost" type="button" classList={{ active: controller.activeID() === tab.id }} onClick={() => controller.selectOverflow(tab.id)}>
                    <Icon name={openTabIcon(tab)} />
                    <span>{controller.label(tab)}</span>
                  </Button>
                )}
              </For>
            </div>
          </Portal>
        </Show>
      </Show>
      <div class="session-open-new-tab-menu">
        <Button appearance="ghost"
          type="button"
          class="session-open-menu-trigger"
          ref={controller.setNewMenuAnchor}
          aria-label="New tab"
          title="New tab"
          aria-expanded={controller.newMenuOpen()}
          onClick={controller.toggleNewMenu}
        >
          <Icon name="plus" />
        </Button>
      </div>
      <Show when={controller.newMenuOpen()}>
        <Portal>
          <div class="session-open-popup-menu session-open-new-tab-panel" ref={controller.setNewMenuPanel} style={controller.newMenuStyle()}>
            <Button appearance="ghost" type="button" onClick={props.addGit}><Icon name="branch" /><span>Git</span></Button>
            <Button appearance="ghost" type="button" onClick={props.addFile}><Icon name="file" /><span>New file</span></Button>
            <Button appearance="ghost" type="button" onClick={props.addTerminal}><Icon name="terminal" /><span>New Terminal</span></Button>
            <Button appearance="ghost" type="button" onClick={props.addContext}><Icon name="context" /><span>Context</span></Button>
            <Button appearance="ghost" type="button" onClick={props.addWeb}><Icon name="browser" /><span>New Webpage</span></Button>
          </div>
        </Portal>
      </Show>
      <OpenTabDragPreviewView preview={controller.dragPreview()} tab={controller.previewTab()} label={controller.previewLabel()} />
    </div>
  )
}

function OpenTabDragPreviewView(props: { preview?: { x: number; y: number; width: number; height: number }; tab?: OpenTab; label?: string }) {
  return <Show when={props.preview && props.tab}><Portal><div class="session-open-tab-drag-preview" style={{ left: `${props.preview?.x ?? 0}px`, top: `${props.preview?.y ?? 0}px`, width: `${props.preview?.width ?? 168}px`, height: `${props.preview?.height ?? 32}px` }}>
    <Icon name={openTabIcon(props.tab!)} /><span>{props.label ?? openTabLabel(props.tab!)}</span>
  </div></Portal></Show>
}
