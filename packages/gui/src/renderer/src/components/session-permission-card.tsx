import { File as FileDiffView } from "@opencode-ai/ui/file"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js"
import { Portal } from "solid-js/web"
import { collapseOutput, patchContents, toolError, toolInput, toolOutput } from "../lib/tool-display"
import { describePermission } from "../lib/safety-present"
import { isKeyboardEditingTarget } from "../lib/keyboard-shortcuts"
import type { ToolPart } from "./session-transcript"
import { ModalFrame } from "./modal-frame"
import { SafetyCardHeader, type SafetyQueuePosition } from "./session-safety-card"
import { Button, Menu, SurfaceCard } from "./ui"

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
  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const [diffOpen, setDiffOpen] = createSignal(false)
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
        if (event.key === "3" || event.key === "Escape") choose("reject")
        if (event.key.toLowerCase() === "f") presentation().diff ? setDiffOpen(true) : setDetailsOpen((open) => !open)
        if (event.key === "ArrowLeft" && props.position.total > 1) props.position.previous()
        if (event.key === "ArrowRight" && props.position.total > 1) props.position.next()
      }}
    >
      <SafetyCardHeader
        icon={presentation().icon}
        label={`Permission - ${presentation().kind}`}
        title={presentation().title}
        titleID={titleID}
        position={props.position}
      />

      <div class="safety-card-body">
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

        <Show when={props.request.patterns.length > 0}>
          <div class="permission-patterns">
            <span>Requested scope</span>
            <div><For each={props.request.patterns}>{(pattern) => <code>{pattern}</code>}</For></div>
          </div>
        </Show>

        <Show when={hasDetails(props.request, input(), props.tool)}>
          <div class="permission-details">
            <Button appearance="ghost" size="compact" trailingIcon={detailsOpen() ? "chevronDown" : "chevronRight"} onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen()}>
              Technical details
            </Button>
            <Show when={detailsOpen()}>
              <div class="permission-details-content">
                <Show when={Object.keys(input()).length > 0}>
                  <section><h3>Tool input</h3><pre>{JSON.stringify(input(), null, 2)}</pre></section>
                </Show>
                <Show when={input() !== props.request.metadata && Object.keys(props.request.metadata).length > 0}>
                  <section><h3>Request metadata</h3><pre>{JSON.stringify(props.request.metadata, null, 2)}</pre></section>
                </Show>
                <Show when={props.tool ? toolOutput(props.tool.state) : undefined}>
                  {(output) => <section><h3>Tool output</h3><pre>{collapseOutput(output()).output}</pre></section>}
                </Show>
                <Show when={props.tool ? toolError(props.tool.state) : undefined}>
                  {(error) => <section><h3>Tool error</h3><pre>{error()}</pre></section>}
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <footer class="safety-card-actions">
        <Button appearance="ghost" tone="danger" onClick={() => choose("reject")} leadingIcon="x">Reject <kbd>3</kbd></Button>
        <div class="permission-allow-actions">
          <Button appearance="solid" tone="accent" onClick={() => choose("once")} leadingIcon="check">Allow once <kbd>1</kbd></Button>
          <Menu placement="top-end">
            <Menu.Trigger as={Button} class="permission-more-trigger" appearance="solid" tone="accent" icon="chevronDown" iconOnly aria-label="More permission options" title="More permission options" />
            <Menu.Portal>
              <Menu.Content class="permission-action-menu">
                <Menu.Item shortcut="2" onSelect={() => choose("always")}>Always allow</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </footer>

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
  const contents = createMemo(() => patchContents(props.diff, props.filePath ?? "diff"))
  return (
    <Show when={contents()} fallback={<pre>{props.diff}</pre>}>
      {(value) => (
        <div class="permission-diff">
          <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle={props.split ? "split" : "unified"} virtualize={false} hunkSeparators="simple" />
        </div>
      )}
    </Show>
  )
}

function hasDetails(request: PermissionRequest, input: Record<string, unknown>, tool?: ToolPart) {
  if (Object.keys(input).length > 0 || Object.keys(request.metadata).length > 0) return true
  if (!tool) return false
  return Boolean(toolOutput(tool.state) || toolError(tool.state))
}
