import { TextAttributes } from "@opentui/core"
import type { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createMemo, Show } from "solid-js"
import { modelDisplay, modelVariants, truncate } from "./opencodex-operation-model"
import type { SwarmRoleDraft } from "./opencodex-operations-types"

export function SwarmCreateRow(props: { title: string; value: string; description?: string; required?: boolean; selected: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={props.selected ? theme.primary : theme.textMuted} onMouseUp={props.onSelect}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={props.selected ? theme.primary : theme.text}>{props.title}<Show when={props.required}><span style={{ fg: theme.error }}> *</span></Show></text>
        <text fg={theme.textMuted}>edit</text>
      </box>
      <text fg={theme.text}>{truncate(props.value, 110)}</text>
      <Show when={props.description}><text fg={theme.textMuted}>{props.description}</text></Show>
    </box>
  )
}

export function SwarmRoleDraftCard(props: {
  role: SwarmRoleDraft
  selected: boolean
  selectedModel?: boolean
  selectedEffort?: boolean
  selectedInstructions?: boolean
  selectedRemove?: boolean
  providers: ReturnType<typeof useSync>["data"]["provider"]
  modelRequired?: boolean
  onSelect?: () => void
  onModel: () => void
  onEffort?: () => void
  onInstructions: () => void
  onRemove?: () => void
}) {
  const { theme } = useTheme()
  const tone = createMemo(() => props.selected ? theme.primary : theme.success)
  const efforts = createMemo(() => modelVariants(props.providers, props.role))
  return (
    <box flexDirection="column" gap={0} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={tone()} onMouseUp={() => props.onSelect?.()}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}><text fg={tone()}>+</text><text attributes={TextAttributes.BOLD} fg={theme.text}>{props.role.name}</text></box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{props.role.skill}.md</text>
          <Show when={props.onRemove}><text fg={props.selectedRemove ? theme.primary : theme.error} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onRemove?.() }}>remove</text></Show>
        </box>
      </box>
      <text fg={theme.textMuted}>{props.role.description}</text>
      <box flexDirection="row" gap={1}>
        <text fg={props.selectedModel ? theme.primary : theme.textMuted} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onModel() }}>model<Show when={props.modelRequired}><span style={{ fg: theme.error }}> *</span></Show></text>
        <text fg={theme.textMuted}>{truncate(modelDisplay(props.providers, props.role), 86)}</text>
        <Show when={props.onEffort && efforts().length > 0}>
          <text fg={props.selectedEffort ? theme.primary : theme.textMuted} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onEffort?.() }}>effort</text>
          <text fg={theme.textMuted}>{props.role.variant ?? "default"}</text>
        </Show>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={props.selectedInstructions ? theme.primary : theme.textMuted} onMouseUp={(event: { stopPropagation(): void }) => { event.stopPropagation(); props.onInstructions() }}>instructions</text>
        <text fg={theme.textMuted}>{props.role.customInstructions.trim() ? truncate(props.role.customInstructions, 80) : "Default role skill only"}</text>
      </box>
    </box>
  )
}

export function SwarmAddAgentCard(props: { selected: boolean; disabled: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={props.selected ? theme.primary : theme.textMuted} onMouseUp={() => !props.disabled && props.onSelect()}>
      <box flexDirection="row" gap={1}><text fg={props.disabled ? theme.textMuted : theme.primary}>+</text><text attributes={TextAttributes.BOLD} fg={props.disabled ? theme.textMuted : theme.text}>Add specialist</text></box>
      <text fg={theme.textMuted}>{props.disabled ? "No predefined specialist roles are available." : "Choose a specialist role, model, and custom instructions."}</text>
    </box>
  )
}
