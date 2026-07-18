import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import type { ComponentProps } from "solid-js"
import { SessionPage } from "./session-page"

export function SessionPageEntry(props: ComponentProps<typeof SessionPage>) {
  return (
    <MarkedProvider>
      <SessionPage {...props} />
    </MarkedProvider>
  )
}
