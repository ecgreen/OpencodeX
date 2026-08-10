# Git panel file tree — match the editor file explorer

**Date:** 2026-08-09
**Status:** Approved (visual match, git panel only, approach A: shared classes)

## Problem

The GUI has two file trees that look different:

- **Editor workspace explorer** (`SessionSideFileExplorer`, `packages/gui/src/renderer/src/components/session-side-file-explorer.tsx`): rounded 30px rows, 13px text, chevron disclosure plus folder/folder-open/file icons, indent `10px + depth×16px`, pseudo-element depth lines, gradient selected state. Styled by base `.workbench-file-row` rules (`styles/pages/workbench/workbench-tree.css`) plus overrides scoped under `.session-open-file-explorer` (`styles/pages/workbench/session-open-file-explorer.css`, `-states.css`).
- **Git panel tree** (inside `SessionSideDiffPanel`, `packages/gui/src/renderer/src/components/session-side-git-view.tsx`): flat square 24px rows, 12px text, chevron only, no file/folder icons, rendered guide `<span>`s, indent via `--indent: depth×14px`. Styled by `.session-side-file-list` rules (`styles/pages/sessions/session-side-files.css`, `-states.css`).

The git panel tree should look like the editor explorer. The editor explorer is the reference and must not change visually.

## Decision

Approach A — the git tree adopts the editor explorer's row classes, and the editor explorer's row CSS is widened to apply in both containers. One source of truth for the look; the trees cannot drift apart again.

Scope: the session git panel tree only. The standalone diff page (`diff-page.tsx`) is out of scope. Visual match only — no filter box or other editor-explorer features are added to the git panel.

## Design

### 1. Markup — `session-side-git-view.tsx` (rows inside `VirtualList`)

Each row switches to the editor explorer's structure:

- Class `workbench-file-row` with existing modifiers (`selected`, `directory`, `expanded`, `deleted`).
- `style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}` replaces `--indent` and the rendered `session-side-tree-guides` spans; depth lines come from the shared `::before/::after` pseudo-elements.
- Disclosure: `workbench-disclosure` chevron (`chevronDown`/`chevronRight`) for directories, `workbench-tree-spacer` for files.
- New: `<Icon name={directory ? (expanded ? "folder-open" : "folder") : "file"} />`.
- Name in a plain `<span>`; drop the `session-side-file-name`/`session-side-disclosure` wrappers.
- The trailing `<small>` with `+adds/-dels` (and Binary/Measuring fallbacks) stays; it occupies the row grid's trailing `auto` columns.
- Unchanged: `role="treeitem"`, `aria-expanded`, click behavior, `VirtualList` with `rowHeight={30}` (matches the editor row's 30px min-height).

### 2. CSS — share the look, don't copy it

- `session-open-file-explorer.css` / `session-open-file-explorer-states.css`: widen row-level selectors from `.session-open-file-explorer .workbench-file-row…` to `:is(.session-open-file-explorer, .session-side-file-list) .workbench-file-row…`. Covers: row grid and indent, radius, fonts/weights, icon colors, depth lines, hover/selected/focus states, disclosure/spacer widths. Same rules, wider scope — no visual change to the editor explorer.
- `session-side-files.css` / `session-side-files-states.css`:
  - Give `.session-side-file-list` the same background treatment as the editor explorer pane.
  - Rewrite kept git-specific rules against the new classes: `small` stat styling; deleted strikethrough as `.session-side-file-list .workbench-file-row.deleted > span`.
  - Delete now-unused rules: `.session-side-file-list button…`, `.session-side-disclosure`, `.session-side-file-name`, `.session-side-tree-guides` (these classes are referenced only by the git view).

### 3. Explicitly unchanged (git-specific behavior kept)

Virtualization, collapse/expand state, reveal-from-request, selection driving the patch pane, +/- metrics, deleted styling, splitter, commit/stage/discard actions. No filter box.

## Testing

- Typecheck and existing gui tests pass.
- Launch the app: editor explorer looks identical to before; git panel tree now matches it (icons, row shape, indent, hover/selected states) while keeping +/- stats and deleted styling.
