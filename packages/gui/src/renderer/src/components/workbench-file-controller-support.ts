import type { WorkbenchOperationResult } from "../lib/store"
import type { WorkbenchPageProps } from "./workbench-page-types"

export type WorkbenchFileControllerInput = {
  props: WorkbenchPageProps
  setNotice: (value: string) => void
  setBusy: (value: string) => void
  runOperation: (operation: () => Promise<WorkbenchOperationResult>) => Promise<WorkbenchOperationResult | undefined>
}

export function confirmWorkbenchFileAction(props: WorkbenchPageProps, value: { title: string; message: string; confirm?: string }) {
  return props.confirm?.(value) ?? Promise.resolve(false)
}

export function askWorkbenchFileText(props: WorkbenchPageProps, value: { title: string; message?: string; value?: string; multiline?: boolean }) {
  return props.askText?.(value) ?? Promise.resolve(undefined)
}
