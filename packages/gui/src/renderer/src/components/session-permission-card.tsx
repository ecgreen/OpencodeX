import { File as FileDiffView } from "@opencode-ai/ui/file"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput } from "@opencode-ai/ui/tool-output-preview"
import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js"
import { Portal } from "solid-js/web"
import { COPY_FULL_LABEL, NESTED_TRANSCRIPT_DIFF_OPTIONS, copyFullToolText, patchContents, toolInput } from "../lib/tool-display"
import { describePermission } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import type { ToolPart } from "./session-transcript"
import { ModalFrame } from "./modal-frame"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import { SafetyDismissConfirm } from "./session-safety-confirm"
import { ToolPreviewText } from "./session-tool-text"
import { Button, SurfaceCard } from "./ui"

type PermissionReply = "once" | "always" | "reject"

export function SessionPermissionCard(props: {
  request: PermissionRequest
  tool?: ToolPart
  position: SafetyQueuePosition
  setCard: (element: HTMLElement) => void
  reply: (request: PermissionRequest, reply: PermissionReply) => void
}) {
  const titleID = `permission-title-${createUniqueId()}`
  const input = createMemo(() => toolInput(props.request, props.tool))
  const presentation = createMemo(() => describePermission(props.request, input()))
  const [diffOpen, setDiffOpen] = createSignal(false)
  const [confirmOpen, setConfirmOpen] = createSignal(false)
  const choose = (reply: PermissionReply) => props.reply(props.request, reply)
  let card: HTMLElement | undefined
  const closeDiff = () => {
    setDiffOpen(false)
    requestAnimationFrame(() => card?.focus({ preventScroll: true }))
  }

  return (
    <SurfaceCard
      class="safety-card permission-card"
      tone="warning"
      role="alertdialog"
      aria-labelledby={titleID}
      tabIndex={-1}
      ref={(element) => { card = element; props.setCard(element) }}
      onKeyDown={(event) => {
        if (isKeyboardEditingTarget(event.target)) return
        if (event.key === "1") choose("once")
        if (event.key === "2") choose("always")
        // Rejection always confirms first - same gesture as the header X.
        if (event.key === "3" || event.key === "Escape") setConfirmOpen(true)
        if (event.key.toLowerCase() === "f" && presentation().diff) setDiffOpen(true)
        if (event.key === "ArrowLeft" && props.position.total > 1) props.position.previous()
        if (event.key === "ArrowRight" && props.position.total > 1) props.position.next()
      }}
    >
      <SafetyCardHeader
        icon={presentation().icon}
        label="Permission Request"
        titleID={titleID}
        position={props.position}
        dismissLabel="Reject request"
        onDismiss={() => setConfirmOpen(true)}
      />

      <div class="safety-card-body">
        <h2 class="safety-card-title">{presentation().title}</h2>
        <Show when={presentation().command}>
          {(command) => <pre class="permission-command"><span aria-hidden="true">$</span><code>{command()}</code></pre>}
        </Show>

        <Show when={presentation().diff}>
          {(diff) => (
            <div class="permission-diff-preview">
              <div class="permission-diff-heading">
                <span>{presentation().filePath ?? "Requested changes"}</span>
                <Button appearance="ghost" size="compact" onClick={() => setDiffOpen(true)}>Expand <kbd>F</kbd></Button>
              </div>
              <PermissionDiff diff={diff()} filePath={presentation().filePath} />
            </div>
          )}
        </Show>

        <Show when={presentation().summary.length > 0}>
          <dl class="permission-summary">
            <For each={presentation().summary}>
              {(row) => <div><dt>{row.label}</dt><dd classList={{ technical: row.technical }}>{row.value}</dd></div>}
            </For>
          </dl>
        </Show>
      </div>

      <footer class="safety-card-actions">
        <span class="safety-action-spacer" />
        <Button appearance="soft" tone="success" onClick={() => choose("always")}>Always allow <kbd>2</kbd></Button>
        <Button appearance="solid" tone="success" onClick={() => choose("once")} leadingIcon="check">Allow once <kbd>1</kbd></Button>
      </footer>

      <SafetyDismissConfirm
        open={confirmOpen()}
        title="Reject this request?"
        body="Claude is waiting on this approval. Rejecting tells Claude it may not run the tool, and it will continue without it."
        confirmLabel="Reject"
        onConfirm={() => { setConfirmOpen(false); choose("reject") }}
        onCancel={() => { setConfirmOpen(false); requestAnimationFrame(() => card?.focus({ preventScroll: true })) }}
      />

      <Show when={diffOpen() && presentation().diff}>
        <Portal>
          <ModalFrame
            title={presentation().filePath ? `Review changes to ${presentation().filePath}` : "Review requested changes"}
            description="Inspect the full diff before deciding whether to allow this operation."
            close={closeDiff}
            class="safety-diff-dialog"
            autofocusClose
          >
            <div class="safety-diff-dialog-body">
              <PermissionDiff diff={presentation().diff!} filePath={presentation().filePath} split />
            </div>
          </ModalFrame>
        </Portal>
      </Show>
    </SurfaceCard>
  )
}

function PermissionDiff(props: { diff: string; filePath?: string; split?: boolean }) {
  const limits = () => props.split ? TOOL_OUTPUT_PREVIEW_LIMITS.expanded : TOOL_OUTPUT_PREVIEW_LIMITS.collapsed
  const preview = createMemo(() => previewToolOutput(props.diff, limits()))
  const contents = createMemo(() => patchContents(preview().text, props.filePath ?? "diff"))
  return (
    <Show when={contents()} fallback={<ToolPreviewText text={props.diff} limits={limits()} />}>
      {(value) => (
        <div class="permission-diff">
          <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle={props.split ? "split" : "unified"} hunkSeparators="simple" {...NESTED_TRANSCRIPT_DIFF_OPTIONS} />
          <Show when={props.split && preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.diff)}>{COPY_FULL_LABEL}</Button></Show>
        </div>
      )}
    </Show>
  )
}
