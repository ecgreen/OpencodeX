import type { WorkbenchOperationResult } from "../lib/store"
import { errorText } from "./workbench-page-helpers"

export function createWorkbenchOperationController(input: {
  confirm?: (value: { title: string; message: string; confirm?: string }) => Promise<boolean>
  setBusy: (value: string) => void
  setNotice: (value: string) => void
}) {
  const confirmWorkbench = (value: { title: string; message: string; confirm?: string }) => input.confirm?.(value) ?? Promise.resolve(false)
  const runOperation = async (operation: () => Promise<WorkbenchOperationResult>) => {
    input.setBusy("operation")
    input.setNotice("")
    try {
      const result = await operation()
      input.setNotice(result.message ?? (result.ok ? "Done." : "Operation failed."))
      return result
    } catch (error) {
      input.setNotice(errorText(error, "Operation failed."))
    } finally {
      input.setBusy("")
    }
  }
  return { confirmWorkbench, runOperation }
}
