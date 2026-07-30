import { Button } from "./ui"
import type { AttentionItem } from "@opencode-ai/sdk/v2/work-item"
import { For, Show } from "solid-js"
import { Icon } from "./icon"

/** What each kind of attention looks like, so the row reads before it is read. */
const KIND_PRESENTATION: Record<AttentionItem["kind"], { icon: string; tone: string }> = {
  permission: { icon: "lock", tone: "warning" },
  input: { icon: "help", tone: "warning" },
  review: { icon: "squareCheck", tone: "review" },
  failure: { icon: "warning", tone: "failed" },
  recovery: { icon: "refresh", tone: "info" },
}

export function AttentionQueue(props: {
  items: AttentionItem[]
  openSession: (sessionID: string) => void
  openSwarm: (swarmID: string) => void
  title?: string
  empty?: string
  limit?: number
}) {
  const items = () => props.limit ? props.items.slice(0, props.limit) : props.items
  return (
    <section class="project-home-panel attention-queue" aria-label={props.title ?? "Attention"}>
      <header>
        <strong>{props.title ?? "Attention"}</strong>
        <small>{props.items.length}</small>
      </header>
      <div>
        <Show when={items().length > 0} fallback={<div class="empty">{props.empty ?? "Nothing needs your attention."}</div>}>
          <For each={items()}>
            {(item) => (
              <Button appearance="ghost"
                type="button"
                class="project-home-row"
                classList={{ [KIND_PRESENTATION[item.kind]?.tone ?? "warning"]: true }}
                data-attention-kind={item.kind}
                disabled={!item.sessionID && !item.swarmID}
                onClick={() => open(item)}
              >
                <span class="attention-queue-glyph" aria-hidden="true">
                  <Icon name={KIND_PRESENTATION[item.kind]?.icon ?? "warning"} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </span>
              </Button>
            )}
          </For>
        </Show>
      </div>
    </section>
  )

  function open(item: AttentionItem) {
    if (item.sessionID) return props.openSession(item.sessionID)
    if (item.swarmID) props.openSwarm(item.swarmID)
  }
}
