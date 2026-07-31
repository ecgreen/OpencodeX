import { Button } from "./ui"
import type { AttentionItem } from "@opencode-ai/sdk/v2/work-item"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import { Icon } from "./icon"
import type { GuiSnapshot } from "../lib/session-api"
import { attentionIcon, attentionOpenable, attentionSession, attentionTone } from "../lib/attention-view"
import { SidebarSessionLink } from "./rail-sidebar-links"

export function AttentionQueue(props: {
  items: AttentionItem[]
  openSession: (sessionID: string) => void
  openSwarm: (swarmID: string) => void
  snapshot?: GuiSnapshot
  sessionPinned?: (sessionID: string) => boolean
  toggleSessionPinned?: (sessionID: string) => void
  renameSession?: (session: Session) => void
  deleteSession?: (session: Session) => void
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
              <Show when={sessionFor(item)} fallback={<AttentionRow item={item} open={open} />}>
                {/* An item that points at a session is that session, so it reads
                    as the same card the session lists use rather than a lookalike. */}
                {(session) => (
                  <SidebarSessionLink
                    session={session()}
                    snapshot={props.snapshot}
                    active={false}
                    pinned={props.sessionPinned?.(session().id)}
                    onClick={() => props.openSession(session().id)}
                    togglePinned={props.toggleSessionPinned ? () => props.toggleSessionPinned?.(session().id) : undefined}
                    renameSession={props.renameSession ? () => props.renameSession?.(session()) : undefined}
                    deleteSession={props.deleteSession ? () => props.deleteSession?.(session()) : undefined}
                  />
                )}
              </Show>
            )}
          </For>
        </Show>
      </div>
    </section>
  )

  function sessionFor(item: AttentionItem) {
    return attentionSession(item, props.snapshot)
  }

  function open(item: AttentionItem) {
    if (item.sessionID) return props.openSession(item.sessionID)
    if (item.swarmID) props.openSwarm(item.swarmID)
  }
}

/**
 * The fallback for attention that is not a session: a swarm, or a goal that is
 * still standing on its own. Only the ones with somewhere to go are buttons -
 * a disabled control reads as "this is broken" when the honest message is that
 * there is simply nothing behind it to open.
 */
function AttentionRow(props: { item: AttentionItem; open: (item: AttentionItem) => void }) {
  const tone = () => attentionTone(props.item)
  const openable = () => attentionOpenable(props.item)
  return (
    <Show
      when={openable()}
      fallback={
        <div class="project-home-row" classList={{ [tone()]: true }} data-attention-kind={props.item.kind}>
          <AttentionRowBody item={props.item} />
        </div>
      }
    >
      <Button
        appearance="ghost"
        type="button"
        class="project-home-row"
        classList={{ [tone()]: true }}
        data-attention-kind={props.item.kind}
        onClick={() => props.open(props.item)}
      >
        <AttentionRowBody item={props.item} />
      </Button>
    </Show>
  )
}

function AttentionRowBody(props: { item: AttentionItem }) {
  return (
    <>
      <span class="attention-queue-glyph" aria-hidden="true">
        <Icon name={attentionIcon(props.item)} />
      </span>
      <span>
        <strong>{props.item.title}</strong>
        <span>{props.item.detail}</span>
      </span>
    </>
  )
}
