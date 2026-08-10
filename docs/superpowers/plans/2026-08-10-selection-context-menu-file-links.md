# Selection Highlight, Native Context Menu & Transcript File Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readable accent-tinted text selection app-wide (dark + light), a native Cut/Copy/Paste right-click menu, and clickable file paths in the session transcript that open in the workspace panel.

**Architecture:** Three independent slices in `packages/gui`. (1) A new tier-1 theme token + `--ds-text-selection` alias feeds one global `::selection` rule and the workbench CodeMirror selection. (2) A pure menu-template function (unit-tested) drives an Electron `context-menu` listener attached to the main window. (3) A pure path-detector (unit-tested) decorates inline-code spans in rendered transcript markdown with the existing `data-side-panel-open-file` attribute — the existing delegated click handler (`openTranscriptTarget` in `session-side-panel-controller.ts`) already opens that attribute in the workspace "open" tab, so no new open mechanism is added.

**Tech Stack:** Electron (main: `Menu`/`MenuItem`), SolidJS renderer, CSS layers with `--theme-*` / `--ds-*` tokens, bun test.

**Spec:** `docs/superpowers/specs/2026-08-10-selection-highlight-and-context-menu-design.md`

## Global Constraints

- Scope is `packages/gui` only. Do NOT modify `packages/ui` (including its Markdown component and pierre styles).
- Embedded browser views (`src/main/browser-ipc.ts` WebContentsViews) are out of scope — main window only.
- The existing `--ds-selection` token (menu/list item highlight) must NOT be renamed or repurposed.
- The global `::selection` rule must NOT set `color` — translucent background only.
- Raw color values are allowed ONLY in `styles/themes/dark.css` / `light.css` (tier-1); everywhere else use `var(--ds-text-selection)`.
- Every commit runs the repo's staged design-system hook automatically (`scripts/check-design-system.ts --staged`); a commit that fails it must be fixed, not bypassed.
- Run unit tests from `packages/gui` (never the repo root — bunfig blocks it): `cd packages/gui && bun test --conditions=browser test/<file>.test.ts`
- Typecheck with: `cd packages/gui && bun run typecheck`

---

### Task 1: Selection highlight tokens + app-wide `::selection`

**Files:**
- Modify: `packages/gui/src/renderer/src/styles/themes/dark.css` (token block near line 31, alias block near line 70)
- Modify: `packages/gui/src/renderer/src/styles/themes/light.css` (token block near line 46)
- Modify: `packages/gui/src/renderer/src/styles/design-base.css` (append rule)
- Modify: `packages/gui/src/renderer/src/styles/pages/workbench/workbench-codemirror-states.css` (all three rules)
- Modify: `packages/gui/src/renderer/src/components/code-editor.tsx:156-159`

**Interfaces:**
- Consumes: existing `--theme-accent` values (dark `#fab283`, light `#9c4418`).
- Produces: `--ds-text-selection` CSS custom property, available app-wide. Later tasks and future styles must use this var for text-selection tinting.

- [ ] **Step 1: Add the dark tier-1 token**

In `packages/gui/src/renderer/src/styles/themes/dark.css`, directly below the `--theme-accent-soft` line (line 31), add:

```css
  --theme-selection-text: rgba(250, 178, 131, 0.3);
```

- [ ] **Step 2: Add the `--ds-*` alias**

In the same file, directly below the `--ds-selection: var(--theme-accent-soft);` line (line 70), add:

```css
    --ds-text-selection: var(--theme-selection-text);
```

(Light mode overrides only tier-1 tokens; the alias inherits automatically — do not add an alias to light.css.)

- [ ] **Step 3: Add the light tier-1 token**

In `packages/gui/src/renderer/src/styles/themes/light.css`, directly below the `--theme-accent-soft` line (line 46), add:

```css
  --theme-selection-text: rgba(156, 68, 24, 0.28);
```

- [ ] **Step 4: Add the global rule**

At the end of `packages/gui/src/renderer/src/styles/design-base.css`, append:

```css
/* Text selection: a translucent accent tint. No color override — the text
   underneath keeps its own color (syntax highlighting, muted text) so a
   selection never makes content unreadable. Chromium's default highlight
   is unusably bright on the dark theme. */
::selection {
  background-color: var(--ds-text-selection);
}
```

- [ ] **Step 5: Align the workbench CodeMirror states CSS**

Replace the entire contents of `packages/gui/src/renderer/src/styles/pages/workbench/workbench-codemirror-states.css` with:

```css
.workbench-codemirror .cm-content ::selection {
  background-color: var(--ds-text-selection);
  color: inherit;
}

.workbench-codemirror .cm-line::selection {
  background-color: var(--ds-text-selection);
  color: inherit;
}

.workbench-codemirror .cm-line *::selection {
  background-color: var(--ds-text-selection);
  color: inherit;
}
```

- [ ] **Step 6: Align the inline CodeMirror theme**

In `packages/gui/src/renderer/src/components/code-editor.tsx` lines 156–159, change the selection rule's `backgroundColor` from `"#264f78"` to the token:

```ts
            ".cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection, .cm-line::selection, .cm-line *::selection": {
              backgroundColor: "var(--ds-text-selection)",
              color: "inherit",
            },
```

- [ ] **Step 7: Typecheck and design-system check**

Run: `cd packages/gui && bun run typecheck && bun run check:design-system`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add packages/gui/src/renderer/src/styles/themes/dark.css packages/gui/src/renderer/src/styles/themes/light.css packages/gui/src/renderer/src/styles/design-base.css packages/gui/src/renderer/src/styles/pages/workbench/workbench-codemirror-states.css packages/gui/src/renderer/src/components/code-editor.tsx
git commit -m "fix(gui): readable accent-tinted text selection in dark and light themes"
```

---

### Task 2: Native right-click Cut/Copy/Paste menu

**Files:**
- Create: `packages/gui/src/main/context-menu.ts`
- Modify: `packages/gui/src/main/index.ts` (inside `createWindow()`, after the `will-navigate` handler around line 178)
- Test: `packages/gui/test/context-menu.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `editContextMenuTemplate(params: EditContextMenuParams): EditContextMenuItem[] | undefined` — pure; `undefined` means "show no menu".
  - `attachEditContextMenu(contents: Electron.WebContents): void` — Electron glue.
  - `type EditContextMenuParams = { isEditable: boolean; selectionText: string; editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean } }`
  - `type EditContextMenuItem = { role: "cut" | "copy" | "paste" | "selectAll"; enabled: boolean } | { type: "separator" }`

- [ ] **Step 1: Write the failing test**

Create `packages/gui/test/context-menu.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { editContextMenuTemplate } from "../src/main/context-menu"

const flags = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }

describe("edit context menu template", () => {
  test("no menu when not editable and nothing selected", () => {
    expect(editContextMenuTemplate({ isEditable: false, selectionText: "", editFlags: flags })).toBeUndefined()
  })

  test("no menu for whitespace-only selection", () => {
    expect(editContextMenuTemplate({ isEditable: false, selectionText: "  \n ", editFlags: flags })).toBeUndefined()
  })

  test("selection in read-only content offers copy and select all", () => {
    expect(editContextMenuTemplate({
      isEditable: false,
      selectionText: "hello",
      editFlags: { ...flags, canCopy: true, canSelectAll: true },
    })).toEqual([
      { role: "copy", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ])
  })

  test("editable field offers cut, copy, paste, select all with edit-flag states", () => {
    expect(editContextMenuTemplate({
      isEditable: true,
      selectionText: "",
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    })).toEqual([
      { role: "cut", enabled: false },
      { role: "copy", enabled: false },
      { role: "paste", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gui && bun test --conditions=browser test/context-menu.test.ts`
Expected: FAIL — cannot resolve `../src/main/context-menu`.

- [ ] **Step 3: Write the implementation**

Create `packages/gui/src/main/context-menu.ts`:

```ts
import { Menu, type WebContents } from "electron"

export type EditContextMenuParams = {
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export type EditContextMenuItem =
  | { role: "cut" | "copy" | "paste" | "selectAll"; enabled: boolean }
  | { type: "separator" }

/**
 * Pure so the menu shape is unit-testable without Electron. `undefined`
 * means "no menu": right-clicking blank space or a graph card stays silent,
 * which keeps the in-app CardContextMenu (which preventDefaults) untouched.
 */
export function editContextMenuTemplate(params: EditContextMenuParams): EditContextMenuItem[] | undefined {
  const hasSelection = params.selectionText.trim().length > 0
  if (!params.isEditable && !hasSelection) return undefined
  return [
    ...(params.isEditable ? [{ role: "cut", enabled: params.editFlags.canCut } as const] : []),
    { role: "copy", enabled: params.editFlags.canCopy },
    ...(params.isEditable ? [{ role: "paste", enabled: params.editFlags.canPaste } as const] : []),
    { type: "separator" },
    { role: "selectAll", enabled: params.editFlags.canSelectAll },
  ]
}

export function attachEditContextMenu(contents: WebContents) {
  contents.on("context-menu", (_event, params) => {
    const template = editContextMenuTemplate({
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
      },
    })
    if (!template) return
    Menu.buildFromTemplate(template).popup()
  })
}
```

Note: bun resolves the `electron` import in tests without executing native bindings because only types and the top-level `Menu` binding are touched at import time; if the test run instead fails on importing `electron`, split the pure parts into `packages/gui/src/main/context-menu-template.ts` (no electron import), re-export them from `context-menu.ts`, and point the test at the template file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/gui && bun test --conditions=browser test/context-menu.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the main window**

In `packages/gui/src/main/index.ts`:

Add to the imports at the top of the file:

```ts
import { attachEditContextMenu } from "./context-menu"
```

Inside `createWindow()`, directly after the `window.webContents.on("will-navigate", ...)` block (ends around line 178), add:

```ts
  attachEditContextMenu(window.webContents)
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/gui && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/gui/src/main/context-menu.ts packages/gui/src/main/index.ts packages/gui/test/context-menu.test.ts
git commit -m "feat(gui): native cut/copy/paste context menu for selections and editable fields"
```

---

### Task 3: Clickable file paths in the session transcript

**Files:**
- Create: `packages/gui/src/renderer/src/lib/transcript-file-links.ts`
- Modify: `packages/gui/src/renderer/src/components/session-transcript.tsx:179-188` (`TextPartView`)
- Modify: `packages/gui/src/renderer/src/styles/pages/sessions/transcript-shell.css` (append rules)
- Test: `packages/gui/test/transcript-file-links.test.ts`

**Interfaces:**
- Consumes: `workbenchPathKey(value: string | undefined): string` from `../src/renderer/src/lib/workbench` (normalizes `\` to `/`, strips `./`); the existing delegated click handler in `session-side-panel-controller.ts` (`openTranscriptTarget`), which already turns any `[data-side-panel-open-file]` element click into `openTarget({ tab: "open", value })` — do NOT add a new click handler.
- Produces:
  - `transcriptFilePath(text: string): string | undefined` — pure detector; returns the normalized path (line suffix stripped) or `undefined`.
  - `decorateTranscriptFileLinks(root: ParentNode): void` — DOM walker that stamps `data-side-panel-open-file` on matching inline-code spans.
  - `observeTranscriptFileLinks(root: HTMLElement): () => void` — starts a MutationObserver, returns a dispose function.

- [ ] **Step 1: Write the failing test**

Create `packages/gui/test/transcript-file-links.test.ts` (pure detector only — unit tests in this repo run without a DOM):

```ts
import { describe, expect, test } from "bun:test"
import { transcriptFilePath } from "../src/renderer/src/lib/transcript-file-links"

describe("transcript file path detection", () => {
  test("accepts repo-relative paths", () => {
    expect(transcriptFilePath("docs/superpowers/specs/2026-08-10-foo-design.md"))
      .toBe("docs/superpowers/specs/2026-08-10-foo-design.md")
    expect(transcriptFilePath("packages/gui/src/main/index.ts")).toBe("packages/gui/src/main/index.ts")
  })

  test("accepts and normalizes backslash and ./ paths", () => {
    expect(transcriptFilePath("packages\\gui\\src\\main\\index.ts")).toBe("packages/gui/src/main/index.ts")
    expect(transcriptFilePath("./docs/README.md")).toBe("docs/README.md")
  })

  test("strips :line and :line:col suffixes", () => {
    expect(transcriptFilePath("src/app.ts:42")).toBe("src/app.ts")
    expect(transcriptFilePath("src/app.ts:42:7")).toBe("src/app.ts")
  })

  test("accepts absolute and dotfile paths", () => {
    expect(transcriptFilePath("C:\\Work\\OpencodeX\\package.json")).toBe("C:/Work/OpencodeX/package.json")
    expect(transcriptFilePath("config/.env")).toBe("config/.env")
  })

  test("rejects URLs and pseudo-URLs", () => {
    expect(transcriptFilePath("https://example.com/a/b.md")).toBeUndefined()
    expect(transcriptFilePath("opencodex://files")).toBeUndefined()
    expect(transcriptFilePath("file://etc/hosts")).toBeUndefined()
  })

  test("rejects non-path inline code", () => {
    expect(transcriptFilePath("const a = 1/2")).toBeUndefined() // whitespace
    expect(transcriptFilePath("package.json")).toBeUndefined() // no separator
    expect(transcriptFilePath("a/b")).toBeUndefined() // no extension
    expect(transcriptFilePath("foo/bar/")).toBeUndefined() // directory
    expect(transcriptFilePath("")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gui && bun test --conditions=browser test/transcript-file-links.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/src/lib/transcript-file-links`.

- [ ] **Step 3: Write the implementation**

Create `packages/gui/src/renderer/src/lib/transcript-file-links.ts`:

```ts
import { workbenchPathKey } from "./workbench"

const schemePattern = /^[a-z][a-z0-9+.-]*:\/\//i
const lineSuffixPattern = /:\d+(?::\d+)?$/
const extensionPattern = /\.[A-Za-z0-9]{1,8}$/

/**
 * Decides whether inline-code text is file-path-shaped. Deliberately strict:
 * a false positive turns prose into a broken link, a false negative is just
 * an inert code span. URLs are excluded — the Markdown component already
 * turns those into external links.
 */
export function transcriptFilePath(text: string): string | undefined {
  const raw = text.trim()
  if (!raw || /\s/.test(raw)) return undefined
  if (schemePattern.test(raw)) return undefined
  const normalized = workbenchPathKey(raw.replace(lineSuffixPattern, ""))
  if (!normalized.includes("/") || normalized.endsWith("/")) return undefined
  const name = normalized.split("/").at(-1) ?? ""
  if (!extensionPattern.test(name)) return undefined
  return normalized
}

/**
 * Stamps `data-side-panel-open-file` on path-shaped inline code. The session
 * page's delegated click handler (openTranscriptTarget) already opens that
 * attribute in the workspace "open" tab, so decoration is the whole feature.
 */
export function decorateTranscriptFileLinks(root: ParentNode) {
  for (const code of Array.from(root.querySelectorAll<HTMLElement>(":not(pre) > code"))) {
    if (code.closest("a[href]")) continue
    const path = transcriptFilePath(code.textContent ?? "")
    if (path) {
      code.dataset.sidePanelOpenFile = path
      if (!code.title) code.title = "Open in workspace"
    } else if (code.dataset.sidePanelOpenFile) {
      delete code.dataset.sidePanelOpenFile
      code.removeAttribute("title")
    }
  }
}

/**
 * The Markdown component re-renders via morphdom while streaming, which can
 * replace decorated nodes, so decoration re-runs on subtree changes. The
 * observer ignores attribute mutations, so stamping data attributes cannot
 * re-trigger it.
 */
export function observeTranscriptFileLinks(root: HTMLElement) {
  const observer = new MutationObserver(() => decorateTranscriptFileLinks(root))
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  decorateTranscriptFileLinks(root)
  return () => observer.disconnect()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/gui && bun test --conditions=browser test/transcript-file-links.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into the transcript text part**

In `packages/gui/src/renderer/src/components/session-transcript.tsx`:

Add to the imports at the top of the file:

```ts
import { observeTranscriptFileLinks } from "../lib/transcript-file-links"
```

Ensure `onCleanup` is included in the existing `solid-js` import.

Replace `TextPartView` (lines 179–188) with:

```tsx
function TextPartView(props: { part: Extract<Part, { type: "text" }>; streaming: boolean }) {
  const text = createMemo(() => props.part.synthetic || props.part.ignored ? "" : props.part.text.trim())
  return (
    <Show when={text()}>
      <div class="part text" ref={(element) => onCleanup(observeTranscriptFileLinks(element))}>
        <Markdown text={text()} cacheKey={props.part.id} streaming={props.streaming} />
      </div>
    </Show>
  )
}
```

- [ ] **Step 6: Add the link affordance styling**

Append to `packages/gui/src/renderer/src/styles/pages/sessions/transcript-shell.css`:

```css
/* Inline code that names a real-looking file path opens in the workspace.
   Dotted underline at rest, accent on hover: clickable without shouting. */
.transcript-shell .part.text code[data-side-panel-open-file] {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  transition: color .14s ease;
}

.transcript-shell .part.text code[data-side-panel-open-file]:hover {
  color: var(--ds-control-accent);
  text-decoration-style: solid;
}
```

- [ ] **Step 7: Typecheck, full-ish test pass, design-system check**

Run: `cd packages/gui && bun run typecheck && bun test --conditions=browser test/transcript-file-links.test.ts test/context-menu.test.ts && bun run check:design-system`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/gui/src/renderer/src/lib/transcript-file-links.ts packages/gui/src/renderer/src/components/session-transcript.tsx packages/gui/src/renderer/src/styles/pages/sessions/transcript-shell.css packages/gui/test/transcript-file-links.test.ts
git commit -m "feat(gui): clickable file paths in session transcript open in workspace"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: evidence for the spec's Testing checklist.

- [ ] **Step 1: Launch the dev app**

Run: `cd packages/gui && bun run dev:electron`

- [ ] **Step 2: Verify selection highlight (dark)**

In dark mode: drag-select text in a session transcript, in the workbench editor, and in the composer input. Expected: soft orange tint, text fully readable in all three.

- [ ] **Step 3: Verify selection highlight (light)**

Switch to light theme (via settings/command palette) and repeat. Expected: soft rust tint, text fully readable.

- [ ] **Step 4: Verify context menu**

- Right-click selected transcript text → native menu with Copy enabled; Copy puts the text on the clipboard.
- Right-click the composer input with clipboard content → Paste enabled and inserts.
- Right-click empty transcript space → no native menu.
- Right-click a session-graph card → the existing in-app menu still appears, no native menu on top.

- [ ] **Step 5: Verify file links**

- Ask the assistant something that yields a message containing an inline-code repo path (or locate an existing one). Expected: dotted underline, pointer cursor, accent on hover; click opens that file in the workspace "open" tab.
- An inline-code URL still opens externally; paths inside fenced code blocks are NOT clickable.

- [ ] **Step 6: Report**

Use the superpowers:verification-before-completion skill before claiming done; capture any failures as fixes in the relevant task's files rather than new ad-hoc changes.
