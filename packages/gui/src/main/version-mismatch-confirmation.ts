import type { CoordinatorIdentity } from "./sidecar-state.js"

export async function confirmCoordinatorVersionMismatch<Window>(input: {
  window: Window
  pending: () => CoordinatorIdentity | undefined
  approve: (identity: CoordinatorIdentity) => void
  showMessageBox: (window: Window, options: {
    type: "warning"
    title: string
    message: string
    detail: string
    buttons: string[]
    defaultId: number
    cancelId: number
    noLink: boolean
  }) => Promise<{ response: number }>
}) {
  const identity = input.pending()
  if (!identity) throw new Error("No coordinator version mismatch is pending.")
  const result = await input.showMessageBox(input.window, {
    type: "warning",
    title: "Attach to a different coordinator version?",
    message: "The client and coordinator versions differ.",
    detail: "Continuing may malfunction because this GUI and the coordinator may use incompatible behavior.",
    buttons: ["Cancel", "Attach anyway"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (result.response !== 1) return false
  input.approve(identity)
  return true
}
