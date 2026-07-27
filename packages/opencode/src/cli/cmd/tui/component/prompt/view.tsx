import type { Accessor } from "solid-js"
import { createMemo, Show } from "solid-js"
import type { BoxRenderable, MouseEvent, PasteEvent, RGBA, TextareaRenderable } from "@opentui/core"
import { decodePasteBytes } from "@opentui/core"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { useLocal } from "@tui/context/local"
import { EmptyBorder, SplitBorder } from "@tui/component/border"
import { tint, useTheme } from "@tui/context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useKV } from "../../context/kv"
import { useLeaderActive, useOpencodeKeymap } from "../../keymap"
import { createFadeIn } from "../../util/signal"
import { Locale } from "@/util/locale"
import { expandPastedTextPlaceholders } from "./part"
import { Autocomplete, type AutocompleteRef } from "./autocomplete"
import type { createPromptEditorContext } from "./editor-context"
import type { createPromptOpencodeXContext } from "./opencodex"
import type { createPromptSessionContext } from "./session-context"
import { fadeColor } from "./helpers"
import type { PromptProps, PromptRef, PromptState } from "./types"
import type { createPromptWorkspaceController } from "./workspace"
import { PromptStatusBar } from "./view-status"

export function PromptView(input: {
  props: PromptProps
  state: PromptState
  status: Accessor<SessionStatus>
  textarea: () => TextareaRenderable
  anchor: () => BoxRenderable
  auto: Accessor<AutocompleteRef | undefined>
  setAuto: (value: AutocompleteRef | undefined) => void
  mountTextarea: (value: TextareaRenderable) => void
  mountAnchor: (value: BoxRenderable) => void
  ref: PromptRef
  submit: () => Promise<boolean>
  paste: (value: string) => Promise<void>
  contentChanged: () => void
  cursorChanged: () => void
  setPrompt: Parameters<typeof Autocomplete>[0]["setPrompt"]
  setExtmark: Parameters<typeof Autocomplete>[0]["setExtmark"]
  fileStyleID: number
  agentStyleID: number
  promptPartTypeID: () => number
  editor: ReturnType<typeof createPromptEditorContext>
  opencodex: ReturnType<typeof createPromptOpencodeXContext>
  session: ReturnType<typeof createPromptSessionContext>
  workspace: ReturnType<typeof createPromptWorkspaceController>
}) {
  const dimensions = useTerminalDimensions()
  const keymap = useOpencodeKeymap()
  const kv = useKV()
  const leader = useLeaderActive()
  const local = useLocal()
  const tuiConfig = useTuiConfig()
  const { theme, syntax } = useTheme()
  const animations = createMemo(() => kv.get("animations_enabled", true))
  const highlight = createMemo(() => {
    if (leader()) return theme.border
    if (input.state.mode === "shell") return theme.primary
    const agent = input.session.agent()
    return agent ? local.agent.color(agent.name) : theme.border
  })
  const agentAlpha = createFadeIn(() => !!input.session.agent(), animations)
  const modelAlpha = createFadeIn(() => !!input.session.agent() && input.state.mode === "normal", animations)
  const variantAlpha = createFadeIn(() => !!input.session.agent() && input.state.mode === "normal" && !!input.session.variant(), animations)
  const border = createMemo(() => tint(theme.border, highlight(), agentAlpha()))
  const placeholder = createMemo(() => {
    if (input.props.showPlaceholder === false) return undefined
    if (input.opencodex.deletedSwarmSession()) return "Deleted swarm session is read-only. Slash commands still work."
    const values = input.state.mode === "shell" ? input.props.placeholders?.shell ?? [] : input.props.placeholders?.normal ?? []
    if (!values.length) return undefined
    const example = values[input.state.placeholder % values.length]
    return input.state.mode === "shell" ? `Run a command... "${example}"` : `Ask anything... "${example}"`
  })

  return (
    <>
      <box ref={input.mountAnchor} visible={input.props.visible !== false} width="100%">
        <box width="100%">
          <Show when={input.opencodex.projectName()}>
            {(name) => <box paddingLeft={2} paddingTop={1} flexShrink={0} flexDirection="row" gap={1}><text fg={theme.textMuted}>Working in</text><text fg={theme.text}>{name()}</text></box>}
          </Show>
          <box border={["left"]} borderColor={border()} customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }} paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0} backgroundColor={theme.backgroundElement} flexGrow={1} width="100%">
            <textarea
              width="100%"
              placeholder={placeholder()}
              placeholderColor={theme.textMuted}
              textColor={leader() ? theme.textMuted : theme.text}
              focusedTextColor={leader() ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={tuiConfig.prompt?.max_height ?? Math.max(6, Math.floor(dimensions().height / 3))}
              onContentChange={input.contentChanged}
              onCursorChange={input.cursorChanged}
              onKeyDown={(event: { preventDefault(): void }) => {
                if (input.props.disabled) event.preventDefault()
              }}
              onSubmit={() => setTimeout(() => setTimeout(() => void input.submit(), 0), 0)}
              onPaste={async (event: PasteEvent) => {
                if (input.props.disabled) {
                  event.preventDefault()
                  return
                }
                const normalized = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                if (!normalized.trim()) {
                  keymap.dispatchCommand("prompt.paste")
                  return
                }
                event.preventDefault()
                await input.paste(normalized)
              }}
              ref={(textarea: TextareaRenderable) => {
                Object.assign(textarea, { getClipboardText: (text: string) => expandPastedTextPlaceholders(text, input.state.prompt.parts) })
                input.mountTextarea(textarea)
                setTimeout(() => {
                  if (!textarea.isDestroyed) textarea.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(event: MouseEvent) => event.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={input.props.disabled ? theme.backgroundElement : theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
              <PromptIdentity state={input.state} swarmName={input.opencodex.swarmName} session={input.session} highlight={highlight} agentAlpha={agentAlpha} modelAlpha={modelAlpha} variantAlpha={variantAlpha} />
              <Show when={Boolean(input.props.right)}><box flexDirection="row" gap={1} alignItems="center">{input.props.right}</box></Show>
            </box>
          </box>
        </box>
        <box height={1} border={["left"]} borderColor={border()} customBorderChars={{ ...EmptyBorder, vertical: theme.backgroundElement.a !== 0 ? "╹" : " " }}>
          <box height={1} border={["bottom"]} borderColor={theme.backgroundElement} customBorderChars={{ ...EmptyBorder, horizontal: theme.backgroundElement.a !== 0 ? "▀" : " " }} />
        </box>
        <PromptStatusBar status={input.status} state={input.state} hint={input.props.hint} editor={input.editor} opencodex={input.opencodex} session={input.session} workspace={input.workspace} />
      </box>
      <Autocomplete
        sessionID={input.props.sessionID}
        ref={input.setAuto}
        anchor={input.anchor}
        input={input.textarea}
        setPrompt={input.setPrompt}
        setExtmark={input.setExtmark}
        value={input.state.prompt.input}
        fileStyleId={input.fileStyleID}
        agentStyleId={input.agentStyleID}
        promptPartTypeId={input.promptPartTypeID}
      />
    </>
  )
}

function PromptIdentity(input: {
  state: PromptState
  swarmName: Accessor<string | undefined>
  session: ReturnType<typeof createPromptSessionContext>
  highlight: Accessor<RGBA>
  agentAlpha: Accessor<number>
  modelAlpha: Accessor<number>
  variantAlpha: Accessor<number>
}) {
  const leader = useLeaderActive()
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <Show when={input.session.effectiveAgent()} fallback={<box height={1} />}>
        {(agent) => <>
          <text fg={fadeColor(input.highlight(), input.agentAlpha())}>{input.state.mode === "shell" ? "Shell" : Locale.titlecase(agent().name)}</text>
          <Show when={input.state.mode === "normal"}>
            <box flexDirection="row" gap={1}>
              <text fg={fadeColor(theme.textMuted, input.modelAlpha())}>·</text>
              <text flexShrink={0} fg={fadeColor(leader() ? theme.textMuted : theme.text, input.modelAlpha())}>{input.swarmName() ?? input.session.modelLabel().model}</text>
              <text fg={fadeColor(theme.textMuted, input.modelAlpha())}>{input.swarmName() ? "Swarm" : input.session.modelLabel().provider}</text>
              <Show when={input.swarmName() === undefined && input.session.variant()}>
                <text fg={fadeColor(theme.textMuted, input.variantAlpha())}>·</text>
                <text><span style={{ fg: fadeColor(theme.warning, input.variantAlpha()), bold: true }}>{input.session.variant()}</span></text>
              </Show>
            </box>
          </Show>
        </>}
      </Show>
    </box>
  )
}
