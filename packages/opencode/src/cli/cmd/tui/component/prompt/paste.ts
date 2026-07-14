import path from "path"
import { fileURLToPath } from "url"
import type { FilePart } from "@opencode-ai/sdk/v2"
import type { TextareaRenderable } from "@opentui/core"
import type { CliRenderer } from "@opentui/core"
import { produce, type SetStoreFunction } from "solid-js/store"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import type { PromptState } from "./types"

export function createPromptPasteController(input: {
  textarea: () => TextareaRenderable
  renderer: CliRenderer
  state: PromptState
  setStore: SetStoreFunction<PromptState>
  pasteStyleID: number
  promptPartTypeID: () => number
  summarize: () => boolean
}) {
  function text(text: string, virtualText: string) {
    const start = input.textarea().visualCursor.offset
    input.textarea().insertText(virtualText + " ")
    const extmarkID = input.textarea().extmarks.create({
      start,
      end: start + virtualText.length,
      virtual: true,
      styleId: input.pasteStyleID,
      typeId: input.promptPartTypeID(),
    })
    input.setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text",
          text,
          source: { text: { start, end: start + virtualText.length, value: virtualText } },
        })
        draft.extmarkToPartIndex.set(extmarkID, partIndex)
      }),
    )
  }

  async function inputText(value: string) {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const content = normalized.trim()
    const filepath = iife(() => {
      const raw = content.replace(/^['"]+|['"]+$/g, "")
      if (raw.startsWith("file://")) {
        try {
          return fileURLToPath(raw)
        } catch {}
      }
      return process.platform === "win32" ? raw : raw.replace(/\\(.)/g, "$1")
    })
    if (!/^(https?):\/\//.test(filepath)) {
      const mime = await Filesystem.mimeType(filepath).catch(() => undefined)
      const filename = path.basename(filepath)
      if (mime === "image/svg+xml") {
        const svg = await Filesystem.readText(filepath).catch(() => undefined)
        if (svg) {
          text(svg, `[SVG: ${filename ?? "image"}]`)
          return
        }
      }
      if (mime?.startsWith("image/") || mime === "application/pdf") {
        const content = await Filesystem.readArrayBuffer(filepath)
          .then((buffer) => Buffer.from(buffer).toString("base64"))
          .catch(() => undefined)
        if (content && mime) {
          attachment({ filename, filepath, mime, content })
          return
        }
      }
    }

    const lineCount = (content.match(/\n/g)?.length ?? 0) + 1
    if ((lineCount >= 3 || content.length > 150) && input.summarize()) {
      text(content, `[Pasted ~${lineCount} lines]`)
      return
    }
    input.textarea().insertText(normalized)
    setTimeout(() => {
      if (input.textarea().isDestroyed) return
      input.textarea().getLayoutNode().markDirty()
      input.renderer.requestRender()
    }, 0)
  }

  function attachment(file: { filename?: string; filepath?: string; content: string; mime: string }) {
    const start = input.textarea().visualCursor.offset
    const pdf = file.mime === "application/pdf"
    const count = input.state.prompt.parts.filter((part) => {
      if (part.type !== "file") return false
      return pdf ? part.mime === "application/pdf" : part.mime.startsWith("image/")
    }).length
    const virtualText = pdf ? `[PDF ${count + 1}]` : `[Image ${count + 1}]`
    input.textarea().insertText(virtualText + " ")
    const extmarkID = input.textarea().extmarks.create({
      start,
      end: start + virtualText.length,
      virtual: true,
      styleId: input.pasteStyleID,
      typeId: input.promptPartTypeID(),
    })
    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file",
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filepath ?? file.filename ?? "",
        text: { start, end: start + virtualText.length, value: virtualText },
      },
    }
    input.setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkID, partIndex)
      }),
    )
  }

  return { text, inputText, attachment }
}
