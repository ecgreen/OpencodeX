import path from "path"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { EditTool } from "@/tool/edit"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { Filesystem } from "@/util/filesystem"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { usePathFormatter } from "@tui/context/path-format"
import { useTheme } from "@tui/context/theme"
import { useSessionView } from "./session-view-context"
import { BlockTool, InlineTool } from "./session-tool-core"
import { formatToolInput, type SessionToolProps } from "./session-tool-types"

export function Write(props: SessionToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + pathFormatter.format(props.input.filePath)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath)}
              syntaxStyle={syntax()}
              content={props.input.content ?? ""}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {pathFormatter.format(props.input.filePath)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Glob(props: SessionToolProps<typeof GlobTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.count}>({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})</Show>
    </InlineTool>
  )
}

export function Read(props: SessionToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const pathFormatter = usePathFormatter()
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed" || props.part.state.time.compacted) return []
    return Array.isArray(props.metadata.loaded) ? props.metadata.loaded.filter((file): file is string => typeof file === "string") : []
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={props.part.state.status === "running"}
        part={props.part}
      >
        Read {pathFormatter.format(props.input.filePath)} {formatToolInput(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>{(filePath) => (
        <box paddingLeft={3}><text paddingLeft={3} fg={theme.textMuted}>↳ Loaded {pathFormatter.format(filePath)}</text></box>
      )}</For>
    </>
  )
}

export function Grep(props: SessionToolProps<typeof GrepTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.matches}>({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})</Show>
    </InlineTool>
  )
}

export function Edit(props: SessionToolProps<typeof EditTool>) {
  const context = useSessionView()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const view = () => context.tui.diff_style === "stacked" ? "unified" : context.width > 120 ? "split" : "unified"
  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + pathFormatter.format(props.input.filePath)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={props.metadata.diff}
              view={view()}
              filetype={filetype(props.input.filePath)}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={context.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {pathFormatter.format(props.input.filePath)} {formatToolInput({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ApplyPatch(props: SessionToolProps<typeof ApplyPatchTool>) {
  const context = useSessionView()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const view = () => context.tui.diff_style === "stacked" ? "unified" : context.width > 120 ? "split" : "unified"
  const title = (file: { type: string; relativePath: string; filePath: string }) => {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + pathFormatter.format(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }
  return (
    <Switch>
      <Match when={(props.metadata.files?.length ?? 0) > 0}>
        <For each={props.metadata.files ?? []}>{(file) => (
          <BlockTool title={title(file)} part={props.part}>
            <Show
              when={file.type !== "delete"}
              fallback={<text fg={theme.diffRemoved}>-{file.deletions} line{file.deletions === 1 ? "" : "s"}</text>}
            >
              <box paddingLeft={1}>
                <diff
                  diff={file.patch}
                  view={view()}
                  filetype={filetype(file.filePath)}
                  syntaxStyle={syntax()}
                  showLineNumbers={true}
                  width="100%"
                  wrapMode={context.diffWrapMode()}
                  fg={theme.text}
                  addedBg={theme.diffAddedBg}
                  removedBg={theme.diffRemovedBg}
                  contextBg={theme.diffContextBg}
                  addedSignColor={theme.diffHighlightAdded}
                  removedSignColor={theme.diffHighlightRemoved}
                  lineNumberFg={theme.diffLineNumber}
                  lineNumberBg={theme.diffContextBg}
                  addedLineNumberBg={theme.diffAddedLineNumberBg}
                  removedLineNumberBg={theme.diffRemovedLineNumberBg}
                />
              </box>
              <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
            </Show>
          </BlockTool>
        )}</For>
      </Match>
      <Match when={true}><InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>Patch</InlineTool></Match>
    </Switch>
  )
}

function Diagnostics(props: {
  diagnostics?: Record<string, Array<{ severity?: number; range: { start: { line: number; character: number } }; message: string }>>
  filePath: string
}) {
  const { theme } = useTheme()
  const errors = createMemo(() => (props.diagnostics?.[Filesystem.normalizePath(props.filePath)] ?? [])
    .filter((diagnostic) => diagnostic.severity === 1)
    .slice(0, 3))
  return (
    <Show when={errors().length}>
      <box><For each={errors()}>{(diagnostic) => (
        <text fg={theme.error}>Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}</text>
      )}</For></box>
    </Show>
  )
}

function filetype(filePath?: string) {
  if (!filePath) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(filePath)]
  return ["typescriptreact", "javascriptreact", "javascript"].includes(language) ? "typescript" : language
}
