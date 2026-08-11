# Selection Highlight & Native Context Menu — Design

**Date:** 2026-08-10
**Status:** Approved

## Problem

1. The GUI defines no `::selection` rule, so drag-selecting text in the session
   workspace (and everywhere else) falls back to Chromium's default highlight —
   a saturated bright blue that makes selected text unreadable in dark mode.
   The workbench CodeMirror editor sets its own selection to solid
   `--theme-info`, which is similarly bright and inconsistent.
2. Right-clicking selected text or an editable field does nothing: Electron's
   main process never handles the `context-menu` event, so there is no default
   Cut/Copy/Paste anywhere in the app.
3. When the assistant mentions a file path in the session transcript (e.g.
   `docs/superpowers/specs/2026-08-10-foo-design.md`), it renders as inert
   inline code. The user has to manually navigate the file workspace to view
   it, even though the workspace can already open arbitrary paths.

## Scope

`packages/gui` only. The shared `packages/ui` / pierre styles (used by the web
UI) stay untouched. Embedded browser views (`browser-ipc.ts` WebContentsViews)
are out of scope — main window only.

## Design

### 1. App-wide selection highlight (dark + light)

- Add a text-selection token to both theme files
  (`src/renderer/src/styles/themes/dark.css` and `light.css`):
  - `--theme-selection-text`: the theme accent at ~30% alpha
    (dark: `rgba(250, 178, 131, 0.3)`; light: the light theme's accent at a
    comparable alpha, tuned so selected text stays readable).
  - Exposed as `--ds-text-selection`. The existing `--ds-selection` token is
    unchanged — it remains the menu/list item highlight.
- One global rule in the GUI's global styles:

  ```css
  ::selection {
    background-color: var(--ds-text-selection);
  }
  ```

  No `color` override — the translucent background keeps the original text
  color (including syntax highlighting and muted text) legible.
- Align the workbench CodeMirror selection: replace the solid `--theme-info`
  backgrounds in `styles/pages/workbench/workbench-codemirror-states.css` and
  the inline selection theme in `components/code-editor.tsx` with
  `var(--ds-text-selection)` so editor and prose selection match.

### 2. Native right-click menu (Electron main process)

- New module `src/main/context-menu.ts`, attached to the main window's
  `webContents` when the window is created (from `src/main/index.ts`).
- Listens for the `context-menu` event and pops a native `Menu` built from
  `params.editFlags`:
  - **Cut** — shown when `isEditable`, enabled when `editFlags.canCut`
  - **Copy** — shown when there is a selection, enabled when `editFlags.canCopy`
  - **Paste** — shown when `isEditable`, enabled when `editFlags.canPaste`
  - separator
  - **Select All** — enabled when `editFlags.canSelectAll`
- Items use Electron menu roles (`cut`, `copy`, `paste`, `selectAll`) so
  clipboard behavior is native and correct.
- Guard: the menu only appears when `params.isEditable` or
  `params.selectionText.trim()` is non-empty. Right-clicking blank space or a
  graph card shows nothing new — the existing in-app `CardContextMenu`
  (which calls `preventDefault`) keeps working untouched.

### 3. Clickable file paths in the session transcript

- Scope: inline `code` spans (`:not(pre) > code`) inside the session
  transcript's rendered markdown. Code blocks, other panels, and the web UI
  are untouched. The shared `packages/ui` Markdown component is NOT modified —
  this is a GUI-side enhancement layered on top of its output (mirroring how
  the component itself decorates URL-shaped inline code into external links).
- Detection: a pure helper in `packages/gui/src/renderer/src/lib` that decides
  whether an inline-code text is file-path-shaped: contains `/` (or `\`), no
  whitespace, ends in a filename with an extension, and is not a URL
  (`scheme://` prefixes are excluded — those stay external links). An optional
  trailing `:line` / `:line:col` suffix is accepted and stripped from the
  opened path.
- Decoration: the transcript's text part wrapper walks the rendered markdown
  and adds `data-file-link="<normalized path>"` to matching spans. Because the
  Markdown component re-renders via morphdom while streaming, decoration
  re-runs on content changes (MutationObserver on the markdown container, or
  re-run in the same effect that owns the container).
- Interaction: a delegated `click` handler on the transcript (the component
  already knows its `sessionID`) — clicking a `[data-file-link]` span calls
  `openSessionWorkspace(sessionID, { tab: "open", value: path, title })`, the
  same existing bridge target the command palette and file explorer use. No
  new open mechanism. Nonexistent paths behave however the workspace "open"
  tab already handles them.
- Styling: `[data-file-link]` gets the transcript link treatment (see
  `role-editor-states.css`, which already styles `.transcript-shell a[href]`):
  pointer cursor, accent underline on hover — enough affordance to read as
  clickable without shouting.

## Testing

Manual verification:

- Launch the app in dark and light themes; select text in the workspace
  transcript, the workbench editor, and a text input. The highlight must be
  the accent tint and the text must remain readable.
- Right-click: selected text (Copy works), an editable field (Cut/Copy/Paste
  states correct, Paste inserts), blank space (no native menu), a graph card
  (existing in-app menu unaffected).
- File paths: an assistant message containing an inline-code repo path shows
  it link-styled; clicking opens that file in the workspace "open" tab. A URL
  in inline code still opens externally; paths inside fenced code blocks stay
  inert. Path detection gets unit tests (path shapes, URLs, `:line` suffixes,
  backslash paths).
