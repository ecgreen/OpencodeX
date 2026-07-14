import { createSignal } from "solid-js"
import {
  workbenchClampPaneWidth,
  WORKBENCH_ASSISTANT_WIDTH,
  WORKBENCH_EXPLORER_WIDTH,
} from "../lib/workbench"

export function createWorkbenchLayoutController(input: {
  explorerCollapsed?: boolean
  explorerWidth?: number
  assistantOpen?: boolean
  assistantWidth?: number
}) {
  const [explorerCollapsed, setExplorerCollapsed] = createSignal(input.explorerCollapsed ?? false)
  const [explorerWidth, setExplorerWidth] = createSignal(workbenchClampPaneWidth(input.explorerWidth, WORKBENCH_EXPLORER_WIDTH))
  const [assistantOpen, setAssistantOpen] = createSignal(input.assistantOpen ?? false)
  const [assistantWidth, setAssistantWidth] = createSignal(workbenchClampPaneWidth(input.assistantWidth, WORKBENCH_ASSISTANT_WIDTH))

  function startResize(kind: "explorer" | "assistant", event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const startX = event.clientX
    const startWidth = kind === "explorer" ? explorerWidth() : assistantWidth()
    const onMove = (moveEvent: PointerEvent) => {
      const delta = kind === "explorer" ? moveEvent.clientX - startX : startX - moveEvent.clientX
      if (kind === "explorer") {
        setExplorerWidth(workbenchClampPaneWidth(startWidth + delta, WORKBENCH_EXPLORER_WIDTH))
        return
      }
      setAssistantWidth(workbenchClampPaneWidth(startWidth + delta, WORKBENCH_ASSISTANT_WIDTH))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return { explorerCollapsed, setExplorerCollapsed, explorerWidth, assistantOpen, setAssistantOpen, assistantWidth, startResize }
}
