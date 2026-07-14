import { useBindings } from "@tui/keymap"
import { openDiffHelpDialog, openDiffSourceDialog } from "./diff-viewer-dialogs"
import type { DiffViewerController } from "./diff-viewer-controller"

export function useDiffViewerBindings(controller: DiffViewerController) {
  const commands = [
    {
      name: "diff.down",
      title: "Move diff viewer down",
      category: "VCS",
      run() {
        controller.move(1)
      },
    },
    {
      name: "diff.up",
      title: "Move diff viewer up",
      category: "VCS",
      run() {
        controller.move(-1)
      },
    },
    {
      name: "diff.page.down",
      title: "Page diff viewer down",
      category: "VCS",
      run() {
        controller.page(1)
      },
    },
    {
      name: "diff.page.up",
      title: "Page diff viewer up",
      category: "VCS",
      run() {
        controller.page(-1)
      },
    },
    {
      name: "diff.toggle",
      title: "Toggle diff viewer item",
      category: "VCS",
      run() {
        controller.toggleSelectedFileTreeRow()
      },
    },
    {
      name: "diff.expand",
      title: "Expand diff viewer item",
      category: "VCS",
      run() {
        controller.expandSelected()
      },
    },
    {
      name: "diff.expand_all",
      title: "Expand all diff viewer folders",
      category: "VCS",
      run() {
        controller.expandAll()
      },
    },
    {
      name: "diff.collapse",
      title: "Collapse diff viewer item",
      category: "VCS",
      run() {
        controller.collapseSelected()
      },
    },
    {
      name: "diff.next_file",
      title: "Jump to next diff file",
      category: "VCS",
      run() {
        controller.jumpRelativePatchFile(1)
      },
    },
    {
      name: "diff.previous_file",
      title: "Jump to previous diff file",
      category: "VCS",
      run() {
        controller.jumpRelativePatchFile(-1)
      },
    },
    {
      name: "diff.mark_reviewed",
      title: "Toggle selected diff file reviewed",
      category: "VCS",
      run() {
        controller.toggleSelectedFileReviewed()
      },
    },
    {
      name: "diff.switch_focus",
      title: "Switch diff viewer focus",
      category: "VCS",
      run() {
        controller.switchFocus()
      },
    },
    {
      name: "diff.toggle_file_tree",
      title: "Toggle diff viewer file tree",
      category: "VCS",
      run() {
        controller.toggleFileTree()
      },
    },
    {
      name: "diff.single_patch",
      title: "Toggle single patch view",
      category: "VCS",
      run() {
        controller.toggleSinglePatch()
      },
    },
    {
      name: "diff.switch_source",
      title: "Switch diff viewer source",
      category: "VCS",
      run() {
        openDiffSourceDialog(controller)
      },
    },
    {
      name: "diff.toggle_view",
      title: "Toggle diff viewer split or unified view",
      category: "VCS",
      run() {
        controller.toggleView()
      },
    },
    {
      name: "diff.help",
      title: "Show more diff viewer shortcuts",
      category: "VCS",
      run() {
        openDiffHelpDialog(controller)
      },
    },
  ]

  useBindings(() => ({
    commands,
    bindings: [
      { key: "j,down", cmd: "diff.down", desc: "Move diff viewer down" },
      { key: "k,up", cmd: "diff.up", desc: "Move diff viewer up" },
      { key: "pagedown,ctrl+f", cmd: "diff.page.down", desc: "Page diff viewer down" },
      { key: "pageup,ctrl+b", cmd: "diff.page.up", desc: "Page diff viewer up" },
      { key: "m", cmd: "diff.mark_reviewed", desc: "Mark selected file reviewed" },
      ...controller.api.tuiConfig.keybinds.gather(
        "diff",
        commands.map((command) => command.name),
      ),
    ],
  }))
}
