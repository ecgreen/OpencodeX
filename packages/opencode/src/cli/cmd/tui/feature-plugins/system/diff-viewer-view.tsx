/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useCommandShortcut } from "@tui/keymap"
import { createDiffViewerController } from "./diff-viewer-controller"
import { useDiffViewerBindings } from "./diff-viewer-commands"
import { DiffViewerFileTree } from "./diff-viewer-file-tree"
import {
  DIFF_FILE_TREE_WIDTH,
  DIFF_PLAIN_TEXT_FILETYPE,
  diffFiletype,
} from "./diff-viewer-model"
import { Panel, PanelGroup, Separator } from "./diff-viewer-ui"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export function DiffViewer(props: { api: TuiPluginApi }) {
  const controller = createDiffViewerController(props.api)
  const themeState = useTheme()
  const theme = () => props.api.theme.current
  const shortcuts = [
    { value: useCommandShortcut("diff.switch_focus"), label: "focus file tree" },
    { value: useCommandShortcut("diff.next_file"), label: "next file" },
    { value: useCommandShortcut("diff.previous_file"), label: "previous file" },
    { value: useCommandShortcut("diff.switch_source"), label: "switch source" },
    { value: useCommandShortcut("diff.mark_reviewed"), label: "mark reviewed" },
    { value: useCommandShortcut("diff.help"), label: "all" },
  ]

  useDiffViewerBindings(controller)

  return (
    <box
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={controller.dimensions().width}
      height={controller.dimensions().height}
    >
      <PanelGroup axis="y" width="100%" height="100%">
        <Panel border="none" flexShrink={0} padding={0} paddingLeft={1}>
          <text fg={theme().text}>Diff </text>
          <text fg={theme().textMuted}>{controller.mode() === "last-turn" ? "last turn" : "working tree"}</text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>
            {controller.files().length} {controller.files().length === 1 ? "file" : "files"}
          </text>
        </Panel>

        <box flexGrow={1} minHeight={0}>
          <Switch>
            <Match when={controller.diff.loading}>
              <DiffViewerState text="Loading diff..." />
            </Match>
            <Match when={!controller.diff.loading && controller.diff.error}>
              <DiffViewerState text="Failed to load diff" error={true} />
            </Match>
            <Match when={!controller.diff.loading && controller.files().length === 0}>
              <DiffViewerState text="No diff!" />
            </Match>
            <Match when={!controller.diff.loading}>
              <PanelGroup axis="x">
                <Show when={controller.showFileTree()}>
                  <DiffViewerFileTree
                    files={controller.files()}
                    loading={controller.diff.loading}
                    error={controller.diff.error}
                    theme={theme()}
                    focused={controller.focus() === "files"}
                    width={DIFF_FILE_TREE_WIDTH}
                    highlightedNode={controller.highlightedFileNode()}
                    selectedFileIndex={controller.selectedFileIndex()}
                    reviewedFileNames={controller.reviewedFileNames()}
                    expandedNodes={controller.expandedFileNodes()}
                    onRowClick={controller.clickFileTreeRow}
                  />
                </Show>

                <Panel flexGrow={1} minHeight={0} border="none">
                  <Separator axis="x" start={controller.showFileTree() ? "edge-out" : undefined} />
                  <scrollbox
                    ref={(element: ScrollBoxRenderable) => controller.setScroll(element)}
                    flexGrow={1}
                    minHeight={0}
                    scrollAcceleration={controller.patchScrollAcceleration()}
                    verticalScrollbarOptions={{ visible: false }}
                    horizontalScrollbarOptions={{ visible: false }}
                  >
                    <For each={controller.visiblePatchFiles()}>
                      {(entry, index) => {
                        const reviewed = () => controller.reviewedFileNames().has(entry.file.file)
                        return (
                          <box ref={(element: BoxRenderable) => controller.registerPatchNode(entry.fileIndex, element)}>
                            {index() !== 0 ? (
                              <Separator axis="x" start={controller.showFileTree() ? "edge" : undefined} />
                            ) : null}
                            <box
                              flexDirection="row"
                              gap={1}
                              flexShrink={0}
                              paddingLeft={1}
                              paddingRight={1}
                              border={controller.patchLeftBorder()}
                              borderColor={theme().border}
                            >
                              <text fg={reviewed() ? theme().textMuted : theme().text}>{entry.file.file}</text>
                              <box flexGrow={1} />
                              <text fg={reviewed() ? theme().textMuted : theme().diffAdded}>+{entry.file.additions}</text>
                              <text fg={reviewed() ? theme().textMuted : theme().diffRemoved}>-{entry.file.deletions}</text>
                            </box>
                            <Separator axis="x" start={controller.showFileTree() ? "edge" : undefined} />
                            <Show
                              when={entry.file.patch}
                              fallback={<text fg={theme().textMuted}>No patch available for this file.</text>}
                            >
                              {(patch) => (
                                <box border={controller.patchLeftBorder()} borderColor={theme().border}>
                                  <diff
                                    diff={patch()}
                                    view={controller.view()}
                                    filetype={reviewed() ? DIFF_PLAIN_TEXT_FILETYPE : diffFiletype(entry.file.file)}
                                    syntaxStyle={themeState.syntax()}
                                    showLineNumbers={true}
                                    width="100%"
                                    wrapMode="char"
                                    fg={reviewed() ? theme().textMuted : theme().text}
                                    addedBg={reviewed() ? theme().backgroundElement : theme().diffAddedBg}
                                    removedBg={reviewed() ? theme().backgroundElement : theme().diffRemovedBg}
                                    addedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightAdded}
                                    removedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightRemoved}
                                    lineNumberFg={theme().diffLineNumber}
                                    addedLineNumberBg={reviewed() ? theme().backgroundElement : theme().diffAddedLineNumberBg}
                                    removedLineNumberBg={reviewed() ? theme().backgroundElement : theme().diffRemovedLineNumberBg}
                                  />
                                </box>
                              )}
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                    <Show when={controller.patchFillerHeight() > 0}>
                      <box
                        height={controller.patchFillerHeight()}
                        border={controller.patchLeftBorder()}
                        borderColor={theme().border}
                      />
                    </Show>
                  </scrollbox>
                  <Separator axis="x" start={controller.showFileTree() ? "edge-in" : undefined} />
                </Panel>
              </PanelGroup>
            </Match>
          </Switch>
        </box>

        <Panel flexShrink={0} gap={2} paddingLeft={1} border="none">
          <For each={shortcuts}>
            {(shortcut) => (
              <Show when={shortcut.value()}>
                {(value) => (
                  <text fg={theme().text}>
                    {value()} <span style={{ fg: theme().textMuted }}>{shortcut.label}</span>
                  </text>
                )}
              </Show>
            )}
          </For>
        </Panel>
      </PanelGroup>
    </box>
  )
}

function DiffViewerState(props: { text: string; error?: boolean }) {
  const theme = useTheme()
  return (
    <>
      <Separator axis="x" />
      <box flexGrow={1} paddingLeft={1}>
        <text fg={props.error ? theme.theme.error : theme.theme.textMuted}>{props.text}</text>
      </box>
    </>
  )
}
