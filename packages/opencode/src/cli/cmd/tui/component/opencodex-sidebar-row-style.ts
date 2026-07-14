import type { createOpencodeXSidebarController } from "./opencodex-sidebar-controller"

export function createOpencodeXSidebarRowStyle(controller: ReturnType<typeof createOpencodeXSidebarController>) {
  const selected = (rowID?: string) => controller.isRowSelected(rowID)
  return {
    selected,
    background: (rowID: string | undefined, active: boolean) =>
      selected(rowID) || active ? (controller.theme.backgroundMenu ?? controller.theme.backgroundElement) : undefined,
    cardBackground: (rowID: string | undefined, active: boolean) =>
      selected(rowID) || active
        ? (controller.theme.backgroundMenu ?? controller.theme.backgroundElement)
        : controller.theme.backgroundPanel,
    textColor: (rowID: string | undefined, fallback = controller.theme.textMuted) =>
      selected(rowID) ? controller.theme.text : fallback,
  }
}
