import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { onMount, onCleanup } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { rename, rm } from "fs/promises"
import type { PromptInfo } from "./history"

const MAX_DRAFT_CHARS = 50_000
const DEBOUNCE_MS = 250
const MAX_DRAFT_ENTRIES = 200

export const DRAFT_MAX_CHARS = MAX_DRAFT_CHARS
export const DRAFT_MAX_ENTRIES = MAX_DRAFT_ENTRIES

export type DraftsFile = Record<string, PromptInfo>

function safeParse(text: string): unknown {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function isPromptPart(value: unknown): value is PromptInfo["parts"][number] {
  if (!value || typeof value !== "object" || !("type" in value)) return false
  const type = (value as { type: unknown }).type
  return type === "text" || type === "file" || type === "agent"
}

export function isPromptInfo(value: unknown): value is PromptInfo {
  if (!value || typeof value !== "object") return false
  const candidate = value as PromptInfo
  if (typeof candidate.input !== "string") return false
  if (candidate.input.length > MAX_DRAFT_CHARS) return false
  if (!Array.isArray(candidate.parts)) return false
  return candidate.parts.every(isPromptPart)
}

function normalizeMode(value: unknown): PromptInfo["mode"] {
  return value === "shell" ? "shell" : value === "normal" ? "normal" : undefined
}

export function parseDrafts(text: string): DraftsFile {
  const parsed: unknown = safeParse(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: DraftsFile = {}
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isPromptInfo(raw)) continue
    const mode = normalizeMode(raw.mode)
    out[key] = {
      input: raw.input,
      ...(mode ? { mode } : {}),
      parts: raw.parts,
    }
  }
  return out
}

function cloneEntry(value: PromptInfo): PromptInfo {
  return {
    input: value.input,
    ...(value.mode ? { mode: value.mode } : {}),
    parts: structuredClone(value.parts),
  }
}

export const { use: usePromptDrafts, provider: PromptDraftsProvider } = createSimpleContext({
  name: "PromptDrafts",
  init: () => {
    const draftsPath = path.join(Global.Path.state, "prompt-drafts.json")
    const [store, setStore] = createStore<{ entries: Record<string, PromptInfo>; ready: boolean }>({
      entries: {},
      ready: false,
    })

    let pending: ReturnType<typeof setTimeout> | undefined
    let lastSnapshot = ""
    let writeInFlight: Promise<void> = Promise.resolve()
    let rawText = ""

    onMount(async () => {
      rawText = await Filesystem.readText(draftsPath).catch(() => "")
      const parsed = parseDrafts(rawText)
      lastSnapshot = JSON.stringify(parsed)
      setStore({ entries: parsed, ready: true })
    })

    onCleanup(() => {
      if (!pending) return
      clearTimeout(pending)
      pending = undefined
    })

    function flush(): Promise<void> {
      pending = undefined
      const snapshot = JSON.stringify(unwrap(store.entries))
      if (snapshot === lastSnapshot) return Promise.resolve()
      lastSnapshot = snapshot
      const tempPath = `${draftsPath}.${process.pid}.${Date.now()}.tmp`
      return Filesystem.writeJson(tempPath, JSON.parse(snapshot))
        .then(() => rename(tempPath, draftsPath))
        .catch(async (error) => {
          await rm(tempPath, { force: true }).catch(() => undefined)
          console.error("Failed to write prompt drafts", { draftsPath, error })
        })
    }

    function scheduleFlush(): void {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        writeInFlight = writeInFlight.then(flush)
      }, DEBOUNCE_MS)
    }

    return {
      get ready() {
        return store.ready
      },
      get(key: string): PromptInfo | undefined {
        return store.entries[key]
      },
      set(key: string, value: PromptInfo): void {
        if (value.input.length > MAX_DRAFT_CHARS) return
        const next = cloneEntry(value)
        setStore(
          produce((draft) => {
            draft.entries[key] = next
            const keys = Object.keys(draft.entries)
            if (keys.length <= MAX_DRAFT_ENTRIES) return
            const surplus = keys.length - MAX_DRAFT_ENTRIES
            for (let i = 0; i < surplus; i++) delete draft.entries[keys[i]]
          }),
        )
        scheduleFlush()
      },
      clear(key: string): void {
        if (!(key in store.entries)) return
        setStore(
          produce((draft) => {
            delete draft.entries[key]
          }),
        )
        scheduleFlush()
      },
      flushNow(): Promise<void> {
        if (pending) {
          clearTimeout(pending)
          pending = undefined
        }
        writeInFlight = writeInFlight.then(flush)
        return writeInFlight
      },
    }
  },
})
