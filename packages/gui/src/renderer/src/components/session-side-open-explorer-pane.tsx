import { createSignal } from "solid-js"
import type { FileNode } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchTreeRow } from "../lib/workbench"
import { SessionSideFileExplorer } from "./session-side-file-explorer"

const EXPLORER_WIDTH_KEY = "opencodex.file-explorer-width"
const DEFAULT_WIDTH = 240
const MIN_WIDTH = 180
const MAX_WIDTH = 480

function clampExplorerWidth(value: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)))
}

function storedExplorerWidth() {
  try {
    const value = Number(localStorage.getItem(EXPLORER_WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? clampExplorerWidth(value) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

/**
 * The explorer beside the open file, with its own resizable width.
 *
 * The width is remembered per install rather than per session: it reflects how
 * much of the pane the reader wants given their window, not anything about the
 * files being browsed.
 */
export function SessionSideOpenExplorerPane(props: {
  directory: string
  filter: string
  setFilter: (value: string) => void
  searchState: "idle" | "loading" | "error"
  matches: FileNode[]
  rows: WorkbenchTreeRow[]
  loading: boolean
  openPath: string
  toggleFolder: (node: FileNode) => void
  openFile: (path: string) => void
  fileStatus?: (path: string) => "dirty" | "session" | undefined
  close: () => void
}) {
  const [width, setWidth] = createSignal(storedExplorerWidth())

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const pointerID = event.pointerId
    const origin = event.clientX
    const startWidth = width()
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      setWidth(clampExplorerWidth(startWidth + (moveEvent.clientX - origin)))
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      try {
        localStorage.setItem(EXPLORER_WIDTH_KEY, String(width()))
      } catch {
        /* storage unavailable */
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  return (
    <div class="session-open-file-pane" style={{ width: `${width()}px` }}>
      <SessionSideFileExplorer
        directory={props.directory}
        filter={props.filter}
        setFilter={props.setFilter}
        searchState={props.searchState}
        matches={props.matches}
        rows={props.rows}
        loading={props.loading}
        openPath={props.openPath}
        toggleFolder={props.toggleFolder}
        openFile={props.openFile}
        fileStatus={props.fileStatus}
        close={props.close}
      />
      <div
        class="session-open-file-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file explorer"
        onPointerDown={startResize}
      />
    </div>
  )
}
