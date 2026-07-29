import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog, type DialogContext } from "../../ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"
import { strip } from "@tui/component/prompt/part"
import { useSessionTimelineMessages } from "./session-timeline-messages"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID?: string) => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const timeline = useSessionTimelineMessages(() => props.sessionID)

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string | undefined>[] => {
    const fullSession = {
      title: "Full session",
      value: undefined,
      onSelect: async (dialog: DialogContext) => {
        const forked = await sdk.client.session.fork({ sessionID: props.sessionID })
        route.navigate({
          sessionID: forked.data!.id,
          type: "session",
        })
        dialog.clear()
      },
    } satisfies DialogSelectOption<string | undefined>
    const result = [] as DialogSelectOption<string | undefined>[]
    for (const { info: message, parts } of timeline()) {
      if (message.role !== "user") continue
      const part = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored) as TextPart
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async (dialog) => {
          const forked = await sdk.client.session.fork({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          const prompt = parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(strip(part))
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          )
          route.navigate({
            sessionID: forked.data!.id,
            type: "session",
            prompt,
          })
          dialog.clear()
        },
      })
    }
    return [fullSession, ...result.reverse()]
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork session" options={options()} />
}
