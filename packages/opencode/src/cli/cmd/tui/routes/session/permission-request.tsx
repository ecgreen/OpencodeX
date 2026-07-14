/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { ShellID } from "@/tool/shell/id"
import { webSearchProviderLabel } from "@/tool/websearch"
import { Locale } from "@/util/locale"
import { usePathFormatter } from "../../context/path-format"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { getScrollAcceleration } from "../../util/scroll"
import { PermissionChoicePrompt } from "./permission-choice"

export function PermissionRequestPrompt(props: {
  request: PermissionRequest
  input: Record<string, unknown>
  onSelect: (option: "once" | "always" | "reject") => void
}) {
  const themeState = useTheme()
  const pathFormatter = usePathFormatter()
  const current = createMemo(() => permissionInfo(props.request, props.input, pathFormatter.format, themeState.theme))

  return (
    <PermissionChoicePrompt
      title="Permission required"
      header={
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={themeState.theme.warning}>△</text>
            <text fg={themeState.theme.text}>Permission required</text>
          </box>
          <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
            <text fg={themeState.theme.textMuted} flexShrink={0}>
              {current().icon}
            </text>
            <text fg={themeState.theme.text}>{current().title}</text>
          </box>
        </box>
      }
      body={current().body}
      options={{ once: "Allow once", always: "Allow always", reject: "Reject" }}
      escapeKey="reject"
      fullscreen
      onSelect={props.onSelect}
    />
  )
}

export function PermissionTextBody(props: { title: string; description?: string; icon?: string }) {
  const themeState = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={themeState.theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={themeState.theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={themeState.theme.text}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

function PermissionEditBody(props: { request: PermissionRequest }) {
  const themeState = useTheme()
  const config = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const filepath = () => (typeof props.request.metadata?.filepath === "string" ? props.request.metadata.filepath : "")
  const diff = () => (typeof props.request.metadata?.diff === "string" ? props.request.metadata.diff : "")
  const view = () => (config.diff_style === "stacked" || dimensions().width <= 120 ? "unified" : "split")
  const language = () => {
    const value = LANGUAGE_EXTENSIONS[path.extname(filepath())]
    return ["typescriptreact", "javascriptreact", "javascript"].includes(value) ? "typescript" : value
  }

  return (
    <box flexDirection="column" gap={1}>
      <Show
        when={diff()}
        fallback={
          <box paddingLeft={1}>
            <text fg={themeState.theme.textMuted}>No diff provided</text>
          </box>
        }
      >
        <scrollbox
          height="100%"
          scrollAcceleration={getScrollAcceleration(config)}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: themeState.theme.background,
              foregroundColor: themeState.theme.borderActive,
            },
          }}
        >
          <diff
            diff={diff()}
            view={view()}
            filetype={language() ?? "none"}
            syntaxStyle={themeState.syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={themeState.theme.text}
            addedBg={themeState.theme.diffAddedBg}
            removedBg={themeState.theme.diffRemovedBg}
            contextBg={themeState.theme.diffContextBg}
            addedSignColor={themeState.theme.diffHighlightAdded}
            removedSignColor={themeState.theme.diffHighlightRemoved}
            lineNumberFg={themeState.theme.diffLineNumber}
            lineNumberBg={themeState.theme.diffContextBg}
            addedLineNumberBg={themeState.theme.diffAddedLineNumberBg}
            removedLineNumberBg={themeState.theme.diffRemovedLineNumberBg}
          />
        </scrollbox>
      </Show>
    </box>
  )
}

function permissionInfo(
  request: PermissionRequest,
  input: Record<string, unknown>,
  formatPath: (value?: string) => string,
  theme: ReturnType<typeof useTheme>["theme"],
): { icon: string; title: string; body: JSX.Element } {
  if (request.permission === "edit") {
    const filepath = typeof request.metadata?.filepath === "string" ? request.metadata.filepath : ""
    return { icon: "→", title: `Edit ${formatPath(filepath)}`, body: <PermissionEditBody request={request} /> }
  }
  if (request.permission === "read") {
    const file = typeof input.filePath === "string" ? input.filePath : ""
    return { icon: "→", title: `Read ${formatPath(file)}`, body: detail("Path", file ? formatPath(file) : "", theme) }
  }
  if (request.permission === "glob" || request.permission === "grep") {
    const pattern = typeof input.pattern === "string" ? input.pattern : ""
    return {
      icon: "✱",
      title: `${request.permission === "glob" ? "Glob" : "Grep"} "${pattern}"`,
      body: detail("Pattern", pattern, theme),
    }
  }
  if (request.permission === "list") {
    const directory = typeof input.path === "string" ? input.path : ""
    return { icon: "→", title: `List ${formatPath(directory)}`, body: detail("Path", directory ? formatPath(directory) : "", theme) }
  }
  if (request.permission === ShellID.ToolID) {
    const title = typeof input.description === "string" && input.description ? input.description : "Shell command"
    const command = typeof input.command === "string" ? input.command : ""
    return { icon: "#", title, body: detail("$", command, theme, true) }
  }
  if (request.permission === "task") {
    const type = typeof input.subagent_type === "string" ? input.subagent_type : "Unknown"
    const description = typeof input.description === "string" ? input.description : ""
    return { icon: "#", title: `${Locale.titlecase(type)} Task`, body: detail("◉", description, theme, true) }
  }
  if (request.permission === "webfetch") {
    const url = typeof input.url === "string" ? input.url : ""
    return { icon: "%", title: `WebFetch ${url}`, body: detail("URL", url, theme) }
  }
  if (request.permission === "websearch") {
    const query = typeof input.query === "string" ? input.query : ""
    return { icon: "◈", title: `${webSearchProviderLabel(input.provider)} "${query}"`, body: detail("Query", query, theme) }
  }
  if (request.permission === "external_directory") {
    const parent = typeof request.metadata?.parentDir === "string" ? request.metadata.parentDir : undefined
    const filepath = typeof request.metadata?.filepath === "string" ? request.metadata.filepath : undefined
    const pattern = request.patterns?.[0]
    const derived = typeof pattern === "string" ? (pattern.includes("*") ? path.dirname(pattern) : pattern) : undefined
    const patterns = (request.patterns ?? []).filter((value): value is string => typeof value === "string")
    return {
      icon: "←",
      title: `Access external directory ${formatPath(parent ?? filepath ?? derived)}`,
      body: (
        <Show when={patterns.length}>
          <box paddingLeft={1} gap={1}>
            <text fg={theme.textMuted}>Patterns</text>
            <box>
              <For each={patterns}>{(value) => <text fg={theme.text}>- {value}</text>}</For>
            </box>
          </box>
        </Show>
      ),
    }
  }
  if (request.permission === "doom_loop") {
    return {
      icon: "⟳",
      title: "Continue after repeated failures",
      body: detail("", "This keeps the session running despite repeated failures.", theme),
    }
  }
  return { icon: "⚙", title: `Call tool ${request.permission}`, body: detail("Tool", request.permission, theme) }
}

function detail(label: string, value: string, theme: ReturnType<typeof useTheme>["theme"], strong = false) {
  const text = label ? `${label}${strong ? " " : ": "}${value}` : value
  return (
    <Show when={value}>
      <box paddingLeft={1}>
        <text fg={strong ? theme.text : theme.textMuted}>{text}</text>
      </box>
    </Show>
  )
}
