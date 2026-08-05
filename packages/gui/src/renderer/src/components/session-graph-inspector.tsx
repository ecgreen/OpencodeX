import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { OpencodeXJob, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem } from "@opencode-ai/sdk/v2/work-item"
import { formatRelative } from "../lib/format"
import type { SessionGraphNode } from "../lib/session-graph"
import { Button } from "./ui"

/** Long lists get their own gate: the transcript is the drawer's main event. */
const FILE_PREVIEW_LIMIT = 6
const OBJECTIVE_PREVIEW_LIMIT = 240

/**
 * The supervision layer between a sparse node card and a full transcript:
 * what the step is, who is running it on what, what it is blocked on, what it
 * has consumed, and what it changed - progressively disclosed so the embedded
 * transcript stays the main event.
 *
 * Sources merge with explicit precedence: the WorkItem where one exists, the
 * step's jobs for attempts and failure history, and the fetched Session
 * record as the fallback for catalog-hidden children that have no WorkItem at
 * all. Elapsed time is computed here with a coarse local clock - the shared
 * work-item selector never carries one, so `elapsedMs` cannot be trusted to
 * arrive populated.
 */
export function SessionGraphInspector(props: {
  node?: SessionGraphNode
  item?: WorkItem
  session?: Session
  jobs?: readonly OpencodeXJob[]
}) {
  const running = () => props.node?.status === "running"
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!running()) return
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(interval))
  })
  const [allFiles, setAllFiles] = createSignal(false)
  const [fullObjective, setFullObjective] = createSignal(false)

  const latestJob = createMemo(() => {
    const jobs = props.jobs ?? []
    if (jobs.length === 0) return undefined
    return jobs.toSorted((left, right) => jobTime(right.timeUpdated) - jobTime(left.timeUpdated))[0]
  })

  const elapsed = createMemo(() => {
    const startedAt = props.item?.startedAt ?? props.node?.startedAt
    if (!startedAt) return undefined
    const end =
      props.item?.completedAt ?? (running() ? now() : (props.item?.updatedAt ?? props.node?.updatedAt))
    if (!end || end < startedAt) return undefined
    return end - startedAt
  })

  const objective = createMemo(() => props.item?.objective ?? "")
  const objectiveClipped = () => objective().length > OBJECTIVE_PREVIEW_LIMIT && !fullObjective()
  const shownObjective = () =>
    objectiveClipped() ? `${objective().slice(0, OBJECTIVE_PREVIEW_LIMIT).trimEnd()}...` : objective()

  const files = createMemo(() => props.item?.changedFiles ?? [])
  const shownFiles = createMemo(() => (allFiles() ? files() : files().slice(0, FILE_PREVIEW_LIMIT)))

  const rows = createMemo(() => {
    const item = props.item
    const job = latestJob()
    const entries: Array<{ label: string; value: string }> = []
    if (item?.agent) entries.push({ label: "Agent", value: item.agent })
    const model =
      item?.providerID || item?.modelID
        ? [item.providerID, item.modelID].filter(Boolean).join(" / ")
        : // Catalog-hidden children carry no WorkItem; the fetched Session
          // record still knows what model the step runs on.
          props.session?.model
          ? [props.session.model.providerID, props.session.model.id].filter(Boolean).join(" / ")
          : undefined
    if (model) entries.push({ label: "Model", value: model })
    if (item?.executionTarget) entries.push({ label: "Runs", value: describeTarget(item.executionTarget) })
    if (item?.blocker) entries.push({ label: "Blocked on", value: item.blocker })
    // Jobs know what the projection flattens away: how many attempts this
    // step has burned, and what the last one died of.
    if (job && (job.attempt > 1 || job.maxAttempts > 1))
      entries.push({ label: "Attempts", value: `${job.attempt} of ${job.maxAttempts}` })
    if (job?.failure?.message) entries.push({ label: "Last failure", value: job.failure.message })
    const elapsedNow = elapsed()
    if (elapsedNow !== undefined) entries.push({ label: "Elapsed", value: formatElapsed(elapsedNow) })
    const use = item?.resourceUse
    const tokens = (use?.inputTokens ?? 0) + (use?.outputTokens ?? 0) + (use?.reasoningTokens ?? 0)
    if (tokens > 0) entries.push({ label: "Tokens", value: tokens.toLocaleString() })
    if (use?.cost) entries.push({ label: "Cost", value: `$${use.cost.toFixed(use.cost < 1 ? 3 : 2)}` })
    if (item?.validation && item.validation.state !== "unknown")
      entries.push({
        label: "Validation",
        value: item.validation.summary
          ? `${item.validation.state} - ${item.validation.summary}`
          : item.validation.state,
      })
    const updated = item?.updatedAt ?? props.session?.time.updated ?? props.node?.updatedAt
    if (updated) entries.push({ label: "Last activity", value: formatRelative(updated) })
    return entries
  })

  const hasContent = () => rows().length > 0 || Boolean(objective()) || files().length > 0

  return (
    <Show when={hasContent()}>
      <details class="session-graph-inspector">
        <summary>Step details</summary>
        <Show when={objective()}>
          <p class="session-graph-inspector-objective">
            {shownObjective()}
            <Show when={objectiveClipped()}>
              {" "}
              <Button appearance="ghost" size="compact" onClick={() => setFullObjective(true)}>
                Show all
              </Button>
            </Show>
          </p>
        </Show>
        <dl class="session-graph-inspector-rows ds-tabular">
          <For each={rows()}>
            {(row) => (
              <>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </>
            )}
          </For>
        </dl>
        <Show when={files().length > 0}>
          <div class="session-graph-inspector-files">
            <strong>Changed files</strong>
            <ul>
              <For each={shownFiles()}>
                {(file) => (
                  <li>
                    <Button
                      appearance="ghost"
                      size="compact"
                      data-side-panel-file={file}
                      class="session-graph-inspector-file"
                    >
                      <span class="ds-truncate">{file}</span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={files().length > FILE_PREVIEW_LIMIT && !allFiles()}>
              <Button appearance="ghost" size="compact" onClick={() => setAllFiles(true)}>
                Show all {files().length}
              </Button>
            </Show>
          </div>
        </Show>
      </details>
    </Show>
  )
}

function describeTarget(target: WorkItem["executionTarget"]) {
  if (target.kind === "direct") return target.directory ? `directly in ${target.directory}` : "directly"
  if (target.kind === "worktree")
    return `worktree${target.branch ? ` ${target.branch}` : ""}${target.directory ? ` (${target.directory})` : ""}`
  return `runner ${target.runnerID}${target.workspace ? ` (${target.workspace})` : ""}`
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.round(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Job timestamps are `number | string` on the wire; mirrors work-item.ts. */
function jobTime(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
