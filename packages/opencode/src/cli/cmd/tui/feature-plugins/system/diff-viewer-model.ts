import type { TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

export const DIFF_ROUTE = "diff"
export const DIFF_MIN_SPLIT_WIDTH = 100
export const DIFF_FILE_TREE_WIDTH = 32
export const DIFF_PLAIN_TEXT_FILETYPE = "opencode-plain-text"
export const DIFF_CONTEXT_LINES = 12
export const DIFF_KV_SHOW_FILE_TREE = "diff_viewer_show_file_tree"
export const DIFF_KV_SINGLE_PATCH = "diff_viewer_single_patch"
export const DIFF_KV_VIEW = "diff_viewer_view"

export type DiffMode = "git" | "last-turn"
export type DiffViewerFocus = "patches" | "files"
export type DiffView = "split" | "unified"
export type DiffParams = {
  mode?: DiffMode
  sessionID?: string
  messageID?: string
  returnRoute?: TuiRouteCurrent
}

export type DiffFile = {
  readonly file: string
  readonly patch?: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

export function normalizeDiffs(diffs: readonly (VcsFileDiff | SnapshotFileDiff)[]): DiffFile[] {
  return diffs.flatMap((item) =>
    item.file
      ? [
          {
            file: item.file,
            patch: item.patch,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status ?? "modified",
          } satisfies DiffFile,
        ]
      : [],
  )
}

export function diffFiletype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

export function storedDiffView(value: unknown): DiffView | undefined {
  if (value === "split" || value === "unified") return value
}
