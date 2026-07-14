/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useCommandShortcut } from "@tui/keymap"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DIFF_ROUTE, type DiffMode } from "./diff-viewer-model"
import type { DiffViewerController } from "./diff-viewer-controller"

export function openDiffSourceDialog(controller: DiffViewerController) {
  const options = [
    {
      title: "Working tree",
      value: "git" as DiffMode,
      description: "Show current git changes",
    },
    {
      title: "Last turn",
      value: "last-turn" as DiffMode,
      description: "Show changes from the last assistant turn",
    },
  ]
  controller.api.ui.dialog.replace(() => (
    <DialogSelect
      title="Switch source"
      skipFilter={true}
      renderFilter={false}
      current={controller.mode()}
      options={options.map((option) => ({
        ...option,
        onSelect(dialog) {
          dialog.clear()
          controller.api.route.navigate(DIFF_ROUTE, {
            mode: option.value,
            sessionID: controller.params()?.sessionID,
            messageID: controller.params()?.messageID,
            returnRoute: controller.params()?.returnRoute,
          })
        },
      }))}
    />
  ))
}

export function openDiffHelpDialog(controller: DiffViewerController) {
  controller.api.ui.dialog.replace(() => <DiffViewerHelpDialog />)
  controller.api.ui.dialog.setSize("large")
}

function DiffViewerHelpDialog() {
  const themeState = useTheme()
  const rows = [
    { shortcut: () => "q", action: "Close viewer", description: "Quit the diff viewer" },
    {
      shortcut: useCommandShortcut("diff.switch_focus"),
      action: "Focus file tree",
      description: "Move keyboard focus between the file tree and patch pane",
    },
    {
      shortcut: useCommandShortcut("diff.next_file"),
      action: "Next file",
      description: "Select the next changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.previous_file"),
      action: "Previous file",
      description: "Select the previous changed file in file-tree order",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_file_tree"),
      action: "Toggle file tree",
      description: "Show or hide the file tree sidebar",
    },
    {
      shortcut: useCommandShortcut("diff.single_patch"),
      action: "Toggle patches",
      description: "Switch between one selected patch and all patches",
    },
    {
      shortcut: useCommandShortcut("diff.switch_source"),
      action: "Switch source",
      description: "Choose working tree or last-turn changes",
    },
    {
      shortcut: useCommandShortcut("diff.toggle_view"),
      action: "Toggle view",
      description: "Switch between split and unified diff layout",
    },
    {
      shortcut: useCommandShortcut("diff.expand_all"),
      action: "Expand all folders",
      description: "Open every folder in the file tree",
    },
    {
      shortcut: useCommandShortcut("diff.mark_reviewed"),
      action: "Mark reviewed",
      description: "Toggle reviewed state for the selected file",
    },
  ]

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeState.theme.text}>
          Diff shortcuts
        </text>
        <text fg={themeState.theme.textMuted}>esc</text>
      </box>
      <box flexDirection="row">
        <text fg={themeState.theme.textMuted} width={5} wrapMode="none">
          Key
        </text>
        <text fg={themeState.theme.textMuted} width={22} wrapMode="none">
          Action
        </text>
        <text fg={themeState.theme.textMuted}>Description</text>
      </box>
      <For each={rows}>
        {(row) => (
          <box flexDirection="row">
            <text fg={themeState.theme.text} width={5} wrapMode="none">
              {row.shortcut() || "-"}
            </text>
            <text fg={themeState.theme.text} width={22} wrapMode="none">
              {row.action}
            </text>
            <text fg={themeState.theme.textMuted}>{row.description}</text>
          </box>
        )}
      </For>
    </box>
  )
}
