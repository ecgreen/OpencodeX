import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import type { ComponentProps } from "solid-js"
import { WorkbenchPage } from "./workbench-page"

export function WorkbenchPageEntry(props: ComponentProps<typeof WorkbenchPage>) {
  return (
    <MarkedProvider>
      <WorkbenchPage {...props} />
    </MarkedProvider>
  )
}
