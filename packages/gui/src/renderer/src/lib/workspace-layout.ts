/**
 * Which of the three columns are on screen: the rail, the session in the
 * middle, and the workspace on the right.
 *
 * The rules live here as one pure step rather than spread across the controls
 * that trigger them, because they are mutual: the middle column may only be
 * put away while the workspace is up, so closing the workspace has to bring the
 * session back or the window would have nothing in it. Stating that once is
 * what makes "every column is closed" unreachable instead of merely unlikely.
 */

export type WorkspaceLayout = {
  /** Whether this route has a workspace at all - only a session or a view does. */
  available: boolean
  workspaceOpen: boolean
  /** The session column, put away so the workspace can have the whole window. */
  centerCollapsed: boolean
}

export type WorkspaceLayoutChange =
  | { type: "available"; available: boolean }
  | { type: "workspace"; open: boolean }
  | { type: "toggleWorkspace" }
  | { type: "center"; collapsed: boolean }
  | { type: "toggleCenter" }

export const EMPTY_WORKSPACE_LAYOUT: WorkspaceLayout = {
  available: false,
  workspaceOpen: false,
  centerCollapsed: false,
}

export function nextWorkspaceLayout(state: WorkspaceLayout, change: WorkspaceLayoutChange): WorkspaceLayout {
  if (change.type === "available") return settle({ ...state, available: change.available })
  if (change.type === "workspace") return settle({ ...state, workspaceOpen: change.open })
  if (change.type === "toggleWorkspace") return settle({ ...state, workspaceOpen: !state.workspaceOpen })
  if (change.type === "center") return settle({ ...state, centerCollapsed: change.collapsed })
  return settle({ ...state, centerCollapsed: !state.centerCollapsed })
}

/**
 * The one place the rules are applied, so no caller can produce a layout that
 * breaks them - including the initial state read back from storage.
 */
function settle(state: WorkspaceLayout): WorkspaceLayout {
  // A route with no workspace has neither a workspace nor a reason to hide the
  // session, so it collapses to the plain case rather than remembering either.
  if (!state.available) return { available: false, workspaceOpen: false, centerCollapsed: false }
  // Putting the session away is only meaningful as "give the workspace the
  // room"; with the workspace down it would leave an empty window.
  if (!state.workspaceOpen) return { ...state, centerCollapsed: false }
  return state
}

/** Whether the session column may be put away right now. */
export function canCollapseCenter(state: WorkspaceLayout) {
  return state.available && state.workspaceOpen
}

/**
 * How wide the workspace may be dragged. The session keeps a readable minimum
 * while it is on screen; the way to give the workspace the whole window is to
 * put the session away, not to squeeze it to nothing.
 */
export const WORKSPACE_WIDTH_MIN = 0.28
export const WORKSPACE_WIDTH_MAX = 0.85

export function clampWorkspaceWidthRatio(value: number) {
  if (!Number.isFinite(value)) return 0.4
  return Math.max(WORKSPACE_WIDTH_MIN, Math.min(WORKSPACE_WIDTH_MAX, value))
}
