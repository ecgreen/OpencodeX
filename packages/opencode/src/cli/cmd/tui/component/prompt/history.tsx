import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const MAX_HISTORY_ENTRIES = 50
const HOME_HISTORY_KEY = "home"

type HistoryLine = {
  key: string
  prompt: PromptInfo
}

export function isDuplicateEntry(previous: PromptInfo | undefined, next: PromptInfo): boolean {
  if (!previous) return false
  return JSON.stringify(previous) === JSON.stringify(next)
}

function parseHistoryLine(line: string): HistoryLine | undefined {
  try {
    const parsed = JSON.parse(line)
    if (isPromptInfo(parsed)) return { key: HOME_HISTORY_KEY, prompt: parsed }
    if (!parsed || typeof parsed !== "object") return undefined
    if (typeof parsed.key !== "string") return undefined
    if (!isPromptInfo(parsed.prompt)) return undefined
    return {
      key: parsed.key,
      prompt: parsed.prompt,
    }
  } catch {
    return undefined
  }
}

function isPromptInfo(value: unknown): value is PromptInfo {
  if (!value || typeof value !== "object") return false
  const item = value as PromptInfo
  return typeof item.input === "string" && Array.isArray(item.parts)
}

function serializeHistoryLine(line: HistoryLine) {
  return JSON.stringify(line)
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyPath = path.join(Global.Path.state, "prompt-history.jsonl")
    onMount(async () => {
      const text = await Filesystem.readText(historyPath).catch(() => "")
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map(parseHistoryLine)
        .filter((line): line is HistoryLine => line !== undefined)

      const history = Object.fromEntries(
        Object.entries(
          lines.reduce<Record<string, PromptInfo[]>>((acc, line) => {
            acc[line.key] = [...(acc[line.key] ?? []), line.prompt].slice(-MAX_HISTORY_ENTRIES)
            return acc
          }, {}),
        ),
      )

      setStore("history", history)

      // Rewrite file with only valid entries to self-heal corruption
      if (lines.length > 0) {
        const content =
          Object.entries(history)
            .flatMap(([key, prompts]) => prompts.map((prompt) => serializeHistoryLine({ key, prompt })))
            .join("\n") + "\n"
        writeFile(historyPath, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      index: {} as Record<string, number>,
      history: {} as Record<string, PromptInfo[]>,
    })

    function list(key: string) {
      return store.history[key] ?? []
    }

    function index(key: string) {
      return store.index[key] ?? 0
    }

    function rewrite() {
      const content =
        Object.entries(store.history)
          .flatMap(([key, prompts]) => prompts.map((prompt) => serializeHistoryLine({ key, prompt })))
          .join("\n") + "\n"
      writeFile(historyPath, content).catch(() => {})
    }

    return {
      seed(key: string, items: PromptInfo[]) {
        const next = items.filter((item) => item.input.length > 0 || item.parts.length > 0)
        if (next.length === 0) return
        setStore(
          produce((draft) => {
            const seen = new Set<string>()
            draft.history[key] = [...next, ...(draft.history[key] ?? [])]
              .filter((item) => {
                const serialized = JSON.stringify(item)
                if (seen.has(serialized)) return false
                seen.add(serialized)
                return true
              })
              .slice(-MAX_HISTORY_ENTRIES)
          }),
        )
      },
      move(key: string, direction: 1 | -1, input: string) {
        const history = list(key)
        if (!history.length) return undefined
        const current = history.at(index(key))
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = index(key) + direction
            if (Math.abs(next) > history.length) return
            if (next > 0) return
            draft.index[key] = next
          }),
        )
        if (index(key) === 0)
          return {
            input: "",
            parts: [],
          }
        return list(key).at(index(key))
      },
      append(key: string, item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        if (isDuplicateEntry(list(key).at(-1), entry)) {
          setStore("index", key, 0)
          return
        }
        let trimmed = false
        setStore(
          produce((draft) => {
            const history = (draft.history[key] ??= [])
            history.push(entry)
            if (history.length > MAX_HISTORY_ENTRIES) {
              draft.history[key] = history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index[key] = 0
          }),
        )

        if (trimmed) {
          rewrite()
          return
        }

        appendFile(historyPath, serializeHistoryLine({ key, prompt: entry }) + "\n").catch(() => {})
      },
    }
  },
})
