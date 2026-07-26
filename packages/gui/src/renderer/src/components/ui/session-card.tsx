import type { JSX } from "solid-js"
import { For, Show, splitProps } from "solid-js"
import { statusPresentation, statusShortLabel } from "../../lib/status-system"
import { StatusBadge } from "./feedback"
import { AgentGlyph, ModelBadge } from "./identity"
import { classes } from "./shared"

export type SessionCardMeta = {
  label: string
  /** Rendered with tabular numerals; keep it short, e.g. "12.4k" or "3m 20s". */
  value: string
}

export type SessionCardProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> & {
  title: string
  status: string
  /** `rail` for the sidebar, `row` for list pages, `card` for the dashboard grid. */
  density?: "rail" | "row" | "card"
  model?: string
  provider?: string
  variant?: string
  /** Agent or role name driving the identity glyph. Defaults to the model. */
  agent?: string
  project?: string
  meta?: SessionCardMeta[]
  /** Progressive-disclosure utilities, revealed on hover and focus-within. */
  actions?: JSX.Element
  selected?: boolean
  onOpen?: () => void
}

/**
 * The atom of the product: one anatomy at three densities.
 *
 * The left stripe and the badge both encode status, so the card stays readable
 * in grayscale. The whole card is the primary action; `actions` are secondary
 * utilities that must remain keyboard reachable.
 */
export function SessionCard(props: SessionCardProps) {
  const [local, rest] = splitProps(props, [
    "title", "status", "density", "model", "provider", "variant", "agent", "project",
    "meta", "actions", "selected", "onOpen", "class", "classList",
  ])
  const presentation = () => statusPresentation(local.status)
  const identity = () => local.agent ?? local.model ?? local.title
  const density = () => local.density ?? "card"

  return (
    <div
      {...rest}
      data-ui="session-card"
      data-density={density()}
      data-tone={presentation().tone}
      data-active={presentation().active ? "true" : undefined}
      data-selected={local.selected ? "true" : undefined}
      class={classes("ui-session-card", local.class)}
      classList={local.classList}
    >
      <button type="button" class="ui-session-card-action" onClick={() => local.onOpen?.()}>
        <span class="ds-visually-hidden">{`Open ${local.title}`}</span>
      </button>
      <Show when={density() !== "rail"}>
        <AgentGlyph class="ui-session-card-glyph" name={identity()} size={density() === "card" ? "prominent" : "default"} />
      </Show>
      <div class="ui-session-card-body">
        <div class="ui-session-card-head">
          <span class="ui-session-card-title ds-truncate">{local.title}</span>
          {/* Rail rows are too narrow to carry the status beside the title, so
              it moves to the trailing edge of the row below. */}
          <Show when={density() !== "rail"}>
            <StatusBadge status={local.status} appearance="soft" />
          </Show>
        </div>
        <Show when={local.model || local.project || density() === "rail"}>
          <div class="ui-session-card-sub">
            <Show when={local.model}>
              {(model) => <ModelBadge model={model()} provider={local.provider} variant={local.variant} />}
            </Show>
            <Show when={local.project}>{(project) => <span class="ui-session-card-project ds-truncate">{project()}</span>}</Show>
            <Show when={density() === "rail"}>
              <StatusBadge class="ui-session-card-rail-status" status={local.status} appearance="bare">
                {statusShortLabel(local.status)}
              </StatusBadge>
            </Show>
          </div>
        </Show>
        <Show when={local.meta && local.meta.length > 0}>
          <dl class="ui-session-card-meta">
            <For each={local.meta}>
              {(item) => (
                <div class="ui-session-card-metric">
                  <dt>{item.label}</dt>
                  <dd class="ds-tabular">{item.value}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
      </div>
      <Show when={local.actions}>{(actions) => <div class="ui-session-card-actions">{actions()}</div>}</Show>
    </div>
  )
}
