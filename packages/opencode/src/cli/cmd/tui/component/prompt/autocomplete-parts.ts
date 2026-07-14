import path from "path"
import { pathToFileURL } from "bun"
import { useSync } from "@tui/context/sync"
import { displayCharAt } from "@/cli/cmd/prompt-display"
import { useFrecency } from "./frecency"
import type { PromptInfo } from "./history"
import type { AutocompleteControllerInput, AutocompleteLineRange } from "./autocomplete-types"

export function createAutocompleteParts(input: AutocompleteControllerInput) {
  const frecency = useFrecency()
  const sync = useSync()

  function insert(text: string, part: PromptInfo["parts"][number]) {
    const textarea = input.props.input()
    const cursorOffset = textarea.cursorOffset
    const append = "@" + text + (displayCharAt(input.props.value, cursorOffset) === " " ? "" : " ")
    textarea.cursorOffset = input.state.index
    const startCursor = textarea.logicalCursor
    textarea.cursorOffset = cursorOffset
    const endCursor = textarea.logicalCursor
    textarea.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    textarea.insertText(append)

    const virtualText = "@" + text
    const start = input.state.index
    const end = start + Bun.stringWidth(virtualText)
    const extmarkID = textarea.extmarks.create({
      start,
      end,
      virtual: true,
      styleId: part.type === "file" ? input.props.fileStyleId : part.type === "agent" ? input.props.agentStyleId : undefined,
      typeId: input.props.promptPartTypeId(),
    })
    input.props.setPrompt((draft) => {
      if (part.type === "file") {
        const existingIndex = draft.parts.findIndex((value) => value.type === "file" && value.url === part.url)
        const existing = draft.parts[existingIndex]
        if (existingIndex !== -1 && existing?.type === "file" && existing.source?.text && part.source?.text) {
          existing.source.text.start = start
          existing.source.text.end = end
          existing.source.text.value = virtualText
          return
        }
      }
      if (part.type === "file" && part.source?.text) {
        part.source.text.start = start
        part.source.text.end = end
        part.source.text.value = virtualText
      }
      if (part.type === "agent" && part.source) {
        part.source.start = start
        part.source.end = end
        part.source.value = virtualText
      }
      const partIndex = draft.parts.length
      draft.parts.push(part)
      input.props.setExtmark(partIndex, extmarkID)
    })
    if (part.type === "file" && part.source?.type === "file") frecency.updateFrecency(part.source.path)
  }

  function file(item: string, lineRange?: AutocompleteLineRange) {
    const baseDir = (sync.path.directory || process.cwd()).replace(/\/+$/, "")
    const url = pathToFileURL(path.isAbsolute(item) ? item : path.join(baseDir, item))
    const filename = lineRange && !item.endsWith("/")
      ? `${item}#${lineRange.startLine}${lineRange.endLine ? `-${lineRange.endLine}` : ""}`
      : item
    applyLineRange(url, item, lineRange)
    return {
      filename,
      url: url.href,
      part: {
        type: "file" as const,
        mime: "text/plain",
        filename,
        url: url.href,
        source: { type: "file" as const, text: { start: 0, end: 0, value: "" }, path: item },
      },
    }
  }

  function referenceFile(value: { alias: string; root: string; item: string; lineRange?: AutocompleteLineRange }) {
    const item = value.lineRange && !value.item.endsWith("/")
      ? `${value.item}#${value.lineRange.startLine}${value.lineRange.endLine ? `-${value.lineRange.endLine}` : ""}`
      : value.item
    const filename = `${value.alias}/${item}`
    const url = pathToFileURL(path.join(value.root, value.item))
    applyLineRange(url, value.item, value.lineRange)
    return {
      filename,
      part: {
        type: "file" as const,
        mime: value.item.endsWith("/") ? "application/x-directory" : "text/plain",
        filename,
        url: url.href,
        source: { type: "file" as const, text: { start: 0, end: 0, value: "" }, path: filename },
      },
    }
  }

  function insertEditorMention(value: { filePath: string; lineStart: number; lineEnd: number }) {
    const baseDir = sync.path.directory || process.cwd()
    const absolute = path.resolve(value.filePath)
    const relative = path.relative(baseDir, absolute)
    const item = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep).join("/")
      : absolute.split(path.sep).join("/")
    const result = file(item, { startLine: value.lineStart, endLine: value.lineEnd > value.lineStart ? value.lineEnd : undefined })
    input.setStore("index", input.state.visible === "@" ? input.state.index : input.props.input().cursorOffset)
    input.setStore("visible", false)
    insert(result.filename, result.part)
  }

  return { insert, file, referenceFile, insertEditorMention, frecency }
}

function applyLineRange(url: URL, item: string, lineRange?: AutocompleteLineRange) {
  if (!lineRange || item.endsWith("/")) return
  url.searchParams.set("start", String(lineRange.startLine))
  if (lineRange.endLine !== undefined) url.searchParams.set("end", String(lineRange.endLine))
}
