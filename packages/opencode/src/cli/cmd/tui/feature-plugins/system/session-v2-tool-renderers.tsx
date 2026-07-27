import stripAnsi from "strip-ansi"
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { webSearchProviderLabel } from "@/tool/websearch"
import { collapseToolOutput } from "../../util/collapse-tool-output"
import { BlockTool, InlineTool } from "./session-v2-tool-primitives"
import { arrayValue, filetype, formatAnswer, input, isRecord, normalizePath, numberValue, pendingInput, stringValue, todoIcon, toolComplete, type ToolProps } from "./session-v2-tool-utils"

export function Bash(props: ToolProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const output = createMemo(() => stripAnsi((stringValue(props.metadata.output) ?? props.output ?? "").trim()))
  const command = createMemo(() => stringValue(props.input.command) ?? pendingInput(props.part))
  const title = createMemo(() => `# ${stringValue(props.input.description) ?? "Shell"}`)
  const [expanded, setExpanded] = createSignal(false)
  const maxLines = 10
  const maxChars = createMemo(() => maxLines * Math.max(20, dimensions().width - 6))
  const collapsed = createMemo(() => collapseToolOutput(output(), maxLines, maxChars()))
  const limited = createMemo(() => {
    if (expanded() || !collapsed().overflow) return output()
    return collapsed().output
  })
  return (
    <Switch>
      <Match when={output()}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={props.part.state.status === "running"}
          onClick={collapsed().overflow ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {command()}</text>
            <text fg={theme.text}>{limited()}</text>
            <Show when={collapsed().overflow}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={command()} part={props.part}>
          {command()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Glob(props: ToolProps) {
  return (
    <InlineTool icon="âœ±" pending="Finding files..." complete={toolComplete(props.part)} part={props.part}>
      Glob "{stringValue(props.input.pattern) ?? pendingInput(props.part)}"{" "}
      <Show when={stringValue(props.input.path)}>in {normalizePath(stringValue(props.input.path))} </Show>
      <Show when={numberValue(props.metadata.count)}>
        {(count) => (
          <>
            ({count()} {count() === 1 ? "match" : "matches"})
          </>
        )}
      </Show>
    </InlineTool>
  )
}

export function Read(props: ToolProps) {
  const { theme } = useTheme()
  const loaded = createMemo(() =>
    arrayValue(props.metadata.loaded).filter((item): item is string => typeof item === "string"),
  )
  return (
    <>
      <InlineTool
        icon="â†’"
        pending="Reading file..."
        complete={stringValue(props.input.filePath) ?? pendingInput(props.part)}
        spinner={props.part.state.status === "running"}
        part={props.part}
      >
        Read {normalizePath(stringValue(props.input.filePath) ?? pendingInput(props.part))}{" "}
        {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3} flexShrink={0}>
            <text paddingLeft={3} fg={theme.textMuted}>
              â†³ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

export function Grep(props: ToolProps) {
  return (
    <InlineTool icon="âœ±" pending="Searching content..." complete={toolComplete(props.part)} part={props.part}>
      Grep "{stringValue(props.input.pattern) ?? pendingInput(props.part)}"{" "}
      <Show when={stringValue(props.input.path)}>in {normalizePath(stringValue(props.input.path))} </Show>
      <Show when={numberValue(props.metadata.matches)}>
        {(matches) => (
          <>
            ({matches()} {matches() === 1 ? "match" : "matches"})
          </>
        )}
      </Show>
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={toolComplete(props.part)} part={props.part}>
      WebFetch {stringValue(props.input.url) ?? pendingInput(props.part)}
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps) {
  const label = createMemo(() => webSearchProviderLabel(props.metadata.provider))
  return (
    <InlineTool icon="â—ˆ" pending="Searching web..." complete={toolComplete(props.part)} part={props.part}>
      {label()} "{stringValue(props.input.query) ?? pendingInput(props.part)}"{" "}
      <Show when={numberValue(props.metadata.numResults)}>{(results) => <>({results()} results)</>}</Show>
    </InlineTool>
  )
}

export function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const filePath = createMemo(() => stringValue(props.input.filePath) ?? "")
  const content = createMemo(() => stringValue(props.input.content) ?? "")
  return (
    <Switch>
      <Match when={content() && props.part.state.status === "completed"}>
        <BlockTool title={"# Wrote " + normalizePath(filePath())} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(filePath())}
              syntaxStyle={syntax()}
              content={content()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={filePath()} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="â†" pending="Preparing write..." complete={filePath()} part={props.part}>
          Write {normalizePath(filePath())}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Edit(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const filePath = createMemo(() => stringValue(props.input.filePath) ?? "")
  const diff = createMemo(() => stringValue(props.metadata.diff))
  return (
    <Switch>
      <Match when={diff()}>
        {(diff) => (
          <BlockTool title={"â† Edit " + normalizePath(filePath())} part={props.part}>
            <box paddingLeft={1}>
              <diff
                diff={diff()}
                view={dimensions().width > 120 ? "split" : "unified"}
                filetype={filetype(filePath())}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                wrapMode="word"
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
            <Diagnostics diagnostics={props.metadata.diagnostics} filePath={filePath()} />
          </BlockTool>
        )}
      </Match>
      <Match when={true}>
        <InlineTool icon="â†" pending="Preparing edit..." complete={filePath()} part={props.part}>
          Edit {normalizePath(filePath())} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ApplyPatch(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const files = createMemo(() => arrayValue(props.metadata.files).flatMap((item) => (isRecord(item) ? [item] : [])))
  const fileTitle = (file: Record<string, unknown>) => {
    const type = stringValue(file.type)
    const relativePath = stringValue(file.relativePath) ?? stringValue(file.filePath) ?? "patch"
    if (type === "delete") return "# Deleted " + relativePath
    if (type === "add") return "# Created " + relativePath
    if (type === "move") return "# Moved " + normalizePath(stringValue(file.filePath)) + " â†’ " + relativePath
    return "â† Patched " + relativePath
  }
  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={fileTitle(file)} part={props.part}>
              <Show
                when={stringValue(file.patch)}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{numberValue(file.deletions) ?? 0} line{numberValue(file.deletions) === 1 ? "" : "s"}
                  </text>
                }
              >
                {(patch) => (
                  <box paddingLeft={1}>
                    <diff
                      diff={patch()}
                      view={dimensions().width > 120 ? "split" : "unified"}
                      filetype={filetype(stringValue(file.filePath) ?? stringValue(file.relativePath))}
                      syntaxStyle={syntax()}
                      showLineNumbers={true}
                      width="100%"
                      wrapMode="word"
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
                )}
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function TodoWrite(props: ToolProps) {
  const { theme } = useTheme()
  const todos = createMemo(() => arrayValue(props.input.todos).flatMap((item) => (isRecord(item) ? [item] : [])))
  return (
    <Switch>
      <Match when={todos().length > 0 && props.part.state.status === "completed"}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={todos()}>
              {(todo) => (
                <text fg={theme.text}>
                  {todoIcon(stringValue(todo.status))} {stringValue(todo.content)}
                </text>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="âš™" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Question(props: ToolProps) {
  const { theme } = useTheme()
  const questions = createMemo(() =>
    arrayValue(props.input.questions).flatMap((item) => (isRecord(item) ? [item] : [])),
  )
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  return (
    <Switch>
      <Match when={answers().length > 0}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={questions()}>
              {(question, index) => (
                <box>
                  <text fg={theme.textMuted}>{stringValue(question.question)}</text>
                  <text fg={theme.text}>{formatAnswer(answers()[index()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="â†’" pending="Asking questions..." complete={questions().length} part={props.part}>
          Asked {questions().length} question{questions().length === 1 ? "" : "s"}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Skill(props: ToolProps) {
  return (
    <InlineTool icon="â†’" pending="Loading skill..." complete={toolComplete(props.part)} part={props.part}>
      Skill "{stringValue(props.input.name) ?? pendingInput(props.part)}"
    </InlineTool>
  )
}

export function Task(props: ToolProps) {
  const content = createMemo(() => {
    const description = stringValue(props.input.description)
    if (!description) return pendingInput(props.part)
    return `${Locale.titlecase(stringValue(props.input.subagent_type) ?? "General")} Task â€” ${description}`
  })
  return (
    <InlineTool
      icon="â”‚"
      spinner={props.part.state.status === "running"}
      complete={toolComplete(props.part)}
      pending="Delegating..."
      part={props.part}
    >
      {content()}
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => {
    if (!isRecord(props.diagnostics)) return []
    const value = props.diagnostics[normalizePath(props.filePath)] ?? props.diagnostics[props.filePath]
    return arrayValue(value)
      .flatMap((item) => (isRecord(item) ? [item] : []))
      .filter((diagnostic) => diagnostic.severity === 1)
      .slice(0, 3)
  })
  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => <text fg={theme.error}>Error {stringValue(diagnostic.message)}</text>}
        </For>
      </box>
    </Show>
  )
}
