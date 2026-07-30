import { For } from "solid-js"

/**
 * Placeholder shown while a file is being read.
 *
 * Swapping files used to blank the pane until the read resolved, which read as
 * a flash of the whole workspace. The shape here mirrors the editor - gutter
 * column, then ragged lines - so the swap reads as the same surface loading
 * rather than a different one appearing.
 */

// Ragged widths so the block reads as code rather than a paragraph. Indents
// repeat on a short cycle for the same reason: real code is mostly shallow.
const LINES = [
  { width: "62%", indent: 0 },
  { width: "48%", indent: 0 },
  { width: "78%", indent: 1 },
  { width: "56%", indent: 1 },
  { width: "40%", indent: 2 },
  { width: "70%", indent: 1 },
  { width: "34%", indent: 0 },
  { width: "66%", indent: 0 },
  { width: "52%", indent: 1 },
  { width: "74%", indent: 1 },
  { width: "44%", indent: 2 },
  { width: "58%", indent: 0 },
  { width: "68%", indent: 0 },
  { width: "38%", indent: 1 },
  { width: "60%", indent: 1 },
  { width: "46%", indent: 0 },
]

export function SessionSideFileSkeleton() {
  return (
    <div class="session-open-file-skeleton" role="status" aria-live="polite" aria-label="Loading file">
      <div class="session-open-file-skeleton-gutter" aria-hidden="true">
        <For each={LINES}>{() => <span />}</For>
      </div>
      <div class="session-open-file-skeleton-code" aria-hidden="true">
        <For each={LINES}>
          {(line) => <span style={{ width: line.width, "margin-inline-start": `${line.indent * 16}px` }} />}
        </For>
      </div>
    </div>
  )
}
