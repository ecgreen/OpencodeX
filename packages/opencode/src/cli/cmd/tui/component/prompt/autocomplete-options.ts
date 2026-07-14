import type { Accessor } from "solid-js"
import { createMemo, createResource, onCleanup } from "solid-js"
import fuzzysort from "fuzzysort"
import { firstBy } from "remeda"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useCommandSlashes } from "../../keymap"
import { Reference } from "@/reference/reference"
import { ConfigReference } from "@/config/reference"
import { Locale } from "@/util/locale"
import type { createAutocompleteParts } from "./autocomplete-parts"
import {
  extractAutocompleteLineRange,
  removeAutocompleteLineRange,
  type AutocompleteControllerInput,
  type AutocompleteOption,
} from "./autocomplete-types"

export function createAutocompleteOptions(input: AutocompleteControllerInput & {
  search: Accessor<string>
  parts: ReturnType<typeof createAutocompleteParts>
}) {
  const project = useProject()
  const sdk = useSDK()
  const slashes = useCommandSlashes()
  const sync = useSync()
  let fileRequest: AbortController | undefined
  let referenceFileRequest: AbortController | undefined
  onCleanup(() => {
    fileRequest?.abort()
    referenceFileRequest?.abort()
  })
  const references = createMemo(() => Reference.resolveAll({
    references: ConfigReference.normalize(sync.data.config.reference ?? {}),
    directory: sync.path.directory || process.cwd(),
    worktree: sync.path.worktree || sync.path.directory || process.cwd(),
  }))
  const referenceSearch = createMemo(() => {
    if (!input.state.visible || input.state.visible === "/") return
    const search = extractAutocompleteLineRange(input.search())
    const slash = search.baseQuery.indexOf("/")
    if (slash === -1) return
    const reference = references().find((item) => item.name === search.baseQuery.slice(0, slash))
    if (!reference || reference.kind === "invalid") return
    return { reference, query: search.baseQuery.slice(slash + 1), lineRange: search.lineRange }
  })
  const [files] = createResource(input.search, async (query) => {
    if (!input.state.visible || input.state.visible === "/" || referenceSearch()) return []
    fileRequest?.abort()
    const request = new AbortController()
    fileRequest = request
    const search = extractAutocompleteLineRange(query ?? "")
    const result = await sdk.client.find.files(
      { query: search.baseQuery, workspace: project.workspace.current() },
      { signal: request.signal },
    )
    if (result.error || !result.data || request.signal.aborted) return []
    const width = input.props.anchor().width - 4
    return result.data
      .toSorted((a, b) => {
        const score = input.parts.frecency.getFrecency(b) - input.parts.frecency.getFrecency(a)
        if (score !== 0) return score
        const depth = a.split("/").length - b.split("/").length
        return depth !== 0 ? depth : a.localeCompare(b)
      })
      .map((item): AutocompleteOption => {
        const result = input.parts.file(item, search.lineRange)
        return {
          display: Locale.truncateMiddle(result.filename, width),
          value: result.filename,
          isDirectory: item.endsWith("/"),
          path: item,
          onSelect: () => input.parts.insert(result.filename, result.part),
        }
      })
  }, { initialValue: [] })
  const [referenceFiles] = createResource(referenceSearch, async (match) => {
    if (!match) return []
    referenceFileRequest?.abort()
    const request = new AbortController()
    referenceFileRequest = request
    const result = await sdk.client.find.files(
      { directory: match.reference.path, query: match.query, limit: 50 },
      { signal: request.signal },
    )
    if (result.error || !result.data || request.signal.aborted) return []
    const width = input.props.anchor().width - 4
    return result.data.map((item): AutocompleteOption => {
      const result = input.parts.referenceFile({
        alias: match.reference.name,
        root: match.reference.path,
        item,
        lineRange: match.lineRange,
      })
      return {
        display: Locale.truncateMiddle(result.filename, width),
        value: result.filename,
        isDirectory: item.endsWith("/"),
        path: result.filename,
        onSelect: () => input.parts.insert(result.filename, result.part),
      }
    })
  }, { initialValue: [] })
  const resources = createMemo(() => {
    if (!input.state.visible || input.state.visible === "/") return []
    const width = input.props.anchor().width - 4
    return Object.values(sync.data.mcp_resource).map((resource): AutocompleteOption => {
      const text = `${resource.name} (${resource.uri})`
      return {
        display: Locale.truncateMiddle(text, width),
        value: text,
        description: resource.description,
        onSelect: () => input.parts.insert(resource.name, {
          type: "file",
          mime: resource.mimeType ?? "text/plain",
          filename: resource.name,
          url: resource.uri,
          source: {
            type: "resource",
            text: { start: 0, end: 0, value: "" },
            clientName: resource.client,
            uri: resource.uri,
          },
        }),
      }
    })
  })
  const agents = createMemo(() => sync.data.agent
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent): AutocompleteOption => ({
      display: "@" + agent.name,
      onSelect: () => input.parts.insert(agent.name, {
        type: "agent",
        name: agent.name,
        source: { start: 0, end: 0, value: "" },
      }),
    })))
  const aliases = createMemo(() => references().map((reference): AutocompleteOption => ({
    display: "@" + reference.name,
    description: reference.kind === "invalid" ? reference.message : " configured reference",
    onSelect: () => input.parts.insert(reference.name, {
      type: "text",
      text: referencePromptText(reference),
      synthetic: true,
    }),
  })))
  const commands = createMemo(() => {
    const options: AutocompleteOption[] = [
      ...slashes(),
      ...sync.data.command
        .filter((command) => command.source !== "skill")
        .map((command): AutocompleteOption => ({
          display: "/" + command.name + (command.source === "mcp" ? ":mcp" : ""),
          description: command.description,
          onSelect: () => {
            const text = "/" + command.name + " "
            const cursor = input.props.input().logicalCursor
            input.props.input().deleteRange(0, 0, cursor.row, cursor.col)
            input.props.input().insertText(text)
            input.props.input().cursorOffset = Bun.stringWidth(text)
          },
        })),
    ].toSorted((a, b) => a.display.localeCompare(b.display))
    const max = firstBy(options, [(option) => option.display.length, "desc"])?.display.length
    return max ? options.map((option) => ({ ...option, display: option.display.padEnd(max + 2) })) : options
  })
  const options = createMemo((previous: AutocompleteOption[] | undefined) => {
    const mixed = input.state.visible === "@"
      ? referenceSearch()
        ? referenceFiles() || []
        : [...aliases(), ...agents(), ...(files() || []), ...resources()]
      : [...commands()]
    if (!input.search()) return mixed
    if ((files.loading || referenceFiles.loading) && previous?.length) return previous
    return fuzzysort.go(removeAutocompleteLineRange(input.search()), mixed, {
      keys: [
        (option) => removeAutocompleteLineRange((option.value ?? option.display).trimEnd()),
        "description",
        (option) => option.aliases?.join(" ") ?? "",
      ],
      limit: 10,
      scoreFn: (results) => {
        const display = results[0]
        const prefix = display?.target.startsWith(input.state.visible + input.search()) ? 2 : 1
        const frecency = results.obj.path ? input.parts.frecency.getFrecency(results.obj.path) : 0
        return results.score * prefix * (1 + frecency)
      },
    }).map((result) => result.obj)
  })

  return options
}

function referencePromptText(reference: Reference.Resolved) {
  const problem = reference.kind === "invalid" ? reference.message : undefined
  return [
    `Referenced configured reference @${reference.name}.`,
    ...(reference.kind === "local" ? ["Kind: local directory"] : []),
    ...(reference.kind === "git" ? ["Kind: git repository"] : []),
    ...(reference.kind === "invalid" && reference.repository ? [`Repository: ${reference.repository}`] : []),
    ...(reference.kind === "git" ? [`Repository: ${reference.repository}`] : []),
    ...(reference.kind === "git" && reference.branch ? [`Branch/ref: ${reference.branch}`] : []),
    ...(reference.kind === "invalid" ? [] : [`Reference root: ${reference.path}`]),
    ...(problem ? [`Problem: ${problem}`] : ["For targeted context, inspect the reference path directly with Read, Glob, and Grep. For broader research, call the task tool with subagent scout and include this reference path."]),
  ].join("\n")
}
