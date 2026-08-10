# Git Panel File Tree Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session git panel's file tree look identical to the editor workspace file explorer by adopting its row classes, while keeping git-specific extras (+/- stats, deleted styling, virtualization).

**Architecture:** The editor explorer's row look lives in base `.workbench-file-row` rules plus overrides scoped under `.session-open-file-explorer`. We (1) swap the git tree's bespoke row markup for the editor row structure, (2) widen the scoped CSS overrides with `:is(.session-open-file-explorer, .session-side-file-list)` so both containers share one source of truth, and (3) delete the retired git-tree CSS. No behavior changes.

**Tech Stack:** SolidJS, plain CSS (design-token variables), Bun test, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-09-git-panel-file-tree-match-design.md`

## Global Constraints

- Editor explorer must not change visually: every widened selector keeps `.session-open-file-explorer` in its `:is()` list; no rule values change in Task 2.
- Preserve e2e contract: container class `session-side-file-list`, `role="treeitem"`, `aria-expanded`, and the `deleted`/`selected`/`directory`/`expanded` row classes (asserted in `packages/gui/e2e/git-workspace.spec.ts` and `file-workspace.spec.ts`).
- All commands run from `packages/gui/` unless noted. Commits trigger a staged design-system check automatically; do not bypass it.
- This is a presentational refactor: no new unit tests are added; regression safety comes from typecheck, existing unit tests, the design-system check, and the two e2e specs.

---

### Task 1: Swap the git tree row markup to the editor row structure

**Files:**
- Modify: `packages/gui/src/renderer/src/components/session-side-git-view.tsx:155-189` (the `render` prop of the `VirtualList`)

**Interfaces:**
- Consumes: `WorkbenchChangeTreeRow` from `../lib/diff-file-tree` (fields: `type`, `path`, `name`, `depth`; `guides` becomes unused by this component but stays in the lib type), `Icon` from `./icon`, existing `collapsedTree()`, `selected()`, `selectFile()`.
- Produces: rows carrying classes `workbench-file-row`, `workbench-disclosure`, `workbench-tree-spacer` and CSS vars `--depth` / `--depth-lines` that Tasks 2–3 style.

- [ ] **Step 1: Replace the row markup**

In `session-side-git-view.tsx`, replace the `render={(row) => { ... }}` body's returned JSX (currently the `Button` containing `session-side-tree-guides`, `session-side-file-name`, and `session-side-disclosure` spans) with:

```tsx
render={(row) => {
  const change = () => row.type === "file" ? props.controller.files().find((file) => file.path === row.path) : undefined
  return (
     <Button appearance="ghost"
       type="button"
       role="treeitem"
       class="workbench-file-row"
       aria-expanded={row.type === "directory" ? !collapsedTree().has(row.path) : undefined}
       classList={{ selected: row.path === selected()?.path, directory: row.type === "directory", expanded: row.type === "directory" && !collapsedTree().has(row.path), deleted: change()?.status === "deleted" }}
      style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}
      onClick={() => {
        if (row.type === "directory") {
          setCollapsedTree((current) => current.has(row.path)
            ? new Set([...current].filter((path) => path !== row.path))
            : new Set([...current, row.path]))
          return
        }
        selectFile(row.path)
      }}
    >
      <Show when={row.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
        <span class="workbench-disclosure"><Icon name={collapsedTree().has(row.path) ? "chevronRight" : "chevronDown"} /></span>
      </Show>
      <Icon name={row.type === "directory" ? collapsedTree().has(row.path) ? "folder" : "folder-open" : "file"} />
      <span>{row.name}</span>
      <Show when={change()}>
        {(file) => <small><Show when={!file().binary} fallback={<span>Binary</span>}><Show when={file().additions !== undefined && file().deletions !== undefined} fallback={<span>Measuring</span>}><b class="diff-additions">+{file().additions}</b><b class="diff-deletions">-{file().deletions}</b></Show></Show></small>}
      </Show>
    </Button>
  )}}
```

Changes vs. before: adds `class="workbench-file-row"` and the folder/folder-open/file `Icon`; `--depth`/`--depth-lines` replace `--indent`; disclosure/spacer use the workbench classes; the guide spans and the `session-side-file-name` wrapper are gone. `onClick`, `classList` flags, `role`, `aria-expanded`, and the `<small>` stats are unchanged.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no unused-import errors — `For` is still used elsewhere in the file by `session-side-patch-pages`; if tsgo reports `For` unused, keep the import only if another usage exists, otherwise remove it from the `solid-js` import).

- [ ] **Step 3: Run the git panel unit tests**

Run: `bun test --conditions=browser test/session-side-git.test.ts test/diff-file-tree.test.ts`
Expected: PASS (these cover the controller and tree flattening, not the markup).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/session-side-git-view.tsx
git commit -m "refactor(gui): git panel tree rows adopt workbench-file-row structure"
```

---

### Task 2: Widen the editor explorer row CSS to also cover the git tree

**Files:**
- Modify: `packages/gui/src/renderer/src/styles/pages/workbench/session-open-file-explorer.css:150-190`
- Modify: `packages/gui/src/renderer/src/styles/pages/workbench/session-open-file-explorer-states.css:11-54`

**Interfaces:**
- Consumes: the classes rendered by Task 1.
- Produces: shared row styling under selector scope `:is(.session-open-file-explorer, .session-side-file-list)` that Task 3 relies on.

- [ ] **Step 1: Widen selectors in `session-open-file-explorer.css`**

Change exactly these five selectors (rule bodies untouched):

| Before | After |
|---|---|
| `.session-open-file-explorer .workbench-file-row` | `:is(.session-open-file-explorer, .session-side-file-list) .workbench-file-row` |
| `.session-open-file-explorer .workbench-file-row.directory` | `:is(.session-open-file-explorer, .session-side-file-list) .workbench-file-row.directory` |
| `.session-open-file-explorer .workbench-file-row>.icon` | `:is(.session-open-file-explorer, .session-side-file-list) .workbench-file-row>.icon` |
| `.session-open-file-explorer .workbench-disclosure` | `:is(.session-open-file-explorer, .session-side-file-list) .workbench-disclosure` |
| `.session-open-file-explorer .workbench-tree-spacer` | `:is(.session-open-file-explorer, .session-side-file-list) .workbench-tree-spacer` |

Do NOT widen the header, filter, search, `.workbench-tree`, marker, skeleton, or dialog rules — those are editor-explorer-only.

- [ ] **Step 2: Widen selectors in `session-open-file-explorer-states.css`**

Same substitution for exactly these six selectors (rule bodies untouched): `.workbench-file-row:before`, `.workbench-file-row:after`, `.workbench-file-row:hover`, `.workbench-file-row:focus-visible`, `.workbench-file-row.selected`, `.workbench-file-row:not(.directory)>.icon` — each currently prefixed with `.session-open-file-explorer `, each becomes prefixed with `:is(.session-open-file-explorer, .session-side-file-list) `. Do NOT touch the two `>header button` rules or `.session-open-empty-actions`.

- [ ] **Step 3: Verify editor explorer CSS is otherwise unchanged**

Run: `git diff --stat src/renderer/src/styles/pages/workbench/`
Expected: only the two files above, with equal-ish insert/delete counts (selector-line changes only).

- [ ] **Step 4: Design-system check + commit**

```bash
bun run check:design-system
git add src/renderer/src/styles/pages/workbench/session-open-file-explorer.css src/renderer/src/styles/pages/workbench/session-open-file-explorer-states.css
git commit -m "refactor(gui): share editor explorer row styling with git panel tree"
```

---

### Task 3: Retire the old git tree CSS and finish the container treatment

**Files:**
- Modify: `packages/gui/src/renderer/src/styles/pages/sessions/session-side-files.css:60-141`
- Modify: `packages/gui/src/renderer/src/styles/pages/sessions/session-side-files-states.css:35-65`

**Interfaces:**
- Consumes: shared row scope from Task 2; markup from Task 1.
- Produces: final `.session-side-file-list` styling (container background, animation opt-out, stats, deleted state).

- [ ] **Step 1: Rewrite the list rules in `session-side-files.css`**

Replace everything from `.session-side-file-list {` (line 60) through the end of the `.session-side-file-list small` rule (line 141) with:

```css
/* The git tree shares the editor explorer's row system (see
   session-open-file-explorer.css). Only container concerns and git-specific
   row extras live here. */
.session-side-file-list {
  min-height: 0;
  overflow: auto;
  background: radial-gradient(circle at 18% 0%,color-mix(in srgb,var(--secondary) 8%,transparent),transparent 32%),color-mix(in srgb,var(--panel) 78%,var(--bg));
}

/* Virtualized rows are recycled while scrolling; the entrance animation from
   the base row class would replay on every recycle, so it is disabled here. */
.session-side-file-list .workbench-file-row {
  animation: none;
}

.session-side-file-list small {
  display: inline-flex;
  gap: 5px;
  font-size: 11px;
}
```

This deletes: `.session-side-file-list button` (+ `.directory`), `.session-side-file-name` (+ `strong`), `.session-side-disclosure` (+ `.placeholder`, `svg`), `.session-side-tree-guides` (+ `span`). Leave every rule before line 60 and after line 141 untouched.

- [ ] **Step 2: Rewrite the state rules in `session-side-files-states.css`**

Delete these rules (lines 35–65): `.session-side-file-list button.selected`, `.session-side-file-list button.deleted .session-side-file-name strong`, `.session-side-file-list button:hover`, `.session-side-file-list button:focus-visible`, `.session-side-file-list button.directory.expanded .session-side-disclosure:after`, `.session-side-tree-guides span.active`. In their place add:

```css
.session-side-file-list .workbench-file-row.deleted > span:not(.workbench-tree-spacer) {
  color: var(--muted);
  text-decoration: line-through;
}
```

(Hover/selected/focus states now come from the shared rules widened in Task 2. Leave the surrounding panel-resize and patch-header rules untouched.)

- [ ] **Step 3: Typecheck, unit tests, design-system check**

Run: `bun run typecheck && bun test --conditions=browser test/design-system.test.ts test/session-side-git.test.ts && bun run check:design-system`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/pages/sessions/session-side-files.css src/renderer/src/styles/pages/sessions/session-side-files-states.css
git commit -m "refactor(gui): retire bespoke git tree styling in favor of shared rows"
```

---

### Task 4: End-to-end verification

**Files:**
- Test: `packages/gui/e2e/git-workspace.spec.ts`, `packages/gui/e2e/file-workspace.spec.ts` (no edits expected — they assert the preserved contract)

**Interfaces:**
- Consumes: everything above.
- Produces: green e2e evidence + screenshots for visual confirmation.

- [ ] **Step 1: Run the full gui unit suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 2: Run the two affected e2e specs**

Run: `bunx playwright test e2e/git-workspace.spec.ts e2e/file-workspace.spec.ts`
Expected: PASS. These assert `role="treeitem"` rows, the `deleted` class after clicking `deleted.ts`, `.session-side-file-list` visibility across viewports/themes, and attach screenshots.

- [ ] **Step 3: Visual check via e2e screenshots**

Open the attached screenshots from the Playwright report (`git-workspace-*` and the file workspace shots). Confirm: git tree rows now show chevron + folder/folder-open/file icons, 30px rounded rows, editor-style hover/selected treatment, +/- stats on file rows; the editor explorer looks unchanged.
Expected: visual match per spec; if anything is off, fix forward in the relevant task's files and re-run this task.

- [ ] **Step 4: Final commit (only if fixes were needed)**

```bash
git add -A src/renderer/src
git commit -m "fix(gui): polish shared git tree row styling"
```

---

## Self-Review Notes

- Spec coverage: markup (§1 → Task 1), shared CSS (§2 first bullet → Task 2), git-side cleanup/background/deleted (§2 second bullet → Task 3), unchanged-behavior + testing (§3–4 → Tasks 1–4). No gaps.
- The `guides`/`parent` fields of `WorkbenchChangeTreeRow` remain in the lib (still used by `diff-file-tree.test.ts` and `reconcileWorkbenchChangeRows` identity checks); only the component stops reading `guides`. YAGNI cleanup of the lib is out of scope.
- `VirtualList` keeps `rowHeight={30}`, matching the shared row's 30px min-height.
