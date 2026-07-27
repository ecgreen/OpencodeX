import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import type { ComponentProps } from "solid-js"
import { ViewsManagerPage } from "./views-manager-page"

export function ViewsManagerPageEntry(props: ComponentProps<typeof ViewsManagerPage>) {
  return (
    <MarkedProvider>
      <ViewsManagerPage {...props} />
    </MarkedProvider>
  )
}
