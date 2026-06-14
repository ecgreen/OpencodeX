import { afterEach, describe, expect, test } from "bun:test"
import type { GuiClient } from "../src/renderer/src/lib/client"
import {
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  loadVcsDiff,
  listWorkbenchFiles,
  readWorkbenchFile,
  renameWorkbenchFile,
  registerGuiBridge,
  workbenchDiagnostics,
  workbenchGitBranches,
  workbenchGitDiff,
  workbenchGitHistory,
  workbenchGitOperation,
  workbenchGitStashCreate,
  workbenchGitStashes,
  workbenchGitStashOperation,
  workbenchGitStatus,
  workbenchGithubData,
  workbenchGithubPost,
  writeWorkbenchFile,
  type DiffFile,
} from "../src/renderer/src/lib/store"
import {
  activeWorkbenchBrowserTab,
  addWorkbenchArtifact,
  addWorkbenchBrowserTab,
  closeWorkbenchBuffer,
  closeWorkbenchBrowserTab,
  flattenWorkbenchFileTree,
  highlightWorkbenchCode,
  isWorkbenchImageContent,
  normalizeWorkbenchDiffs,
  parseWorkbenchState,
  readWorkbenchState,
  renameWorkbenchBuffer,
  updateWorkbenchBuffer,
  updateWorkbenchBrowserTabState,
  updateWorkbenchBrowserTabURL,
  upsertWorkbenchBuffer,
  workbenchAncestorPaths,
  workbenchArtifactOpenURL,
  workbenchBufferDirty,
  workbenchBrowserPageArtifact,
  workbenchBrowserTabLabel,
  workbenchClampPaneWidth,
  workbenchDiffCopyText,
  workbenchDiffPrompt,
  workbenchDirtyState,
  workbenchDirtyBufferPaths,
  workbenchDirtyPathSet,
  workbenchDiffForPath,
  workbenchFileAssistantPrompt,
  workbenchFilteredGitChangeRows,
  workbenchGitFileStats,
  workbenchGitChangeGroups,
  workbenchGitChangeRows,
  workbenchGitSummary,
  workbenchGithubLinks,
  workbenchGithubPullLink,
  workbenchLanguageID,
  workbenchLineStates,
  workbenchNewFileDraft,
  workbenchNormalizeBrowserURL,
  workbenchOpenFileOptions,
  workbenchParentPath,
  workbenchPatchRows,
  workbenchProjectScopes,
  workbenchPathKey,
  workbenchPullNumber,
  workbenchPromptTarget,
  writeWorkbenchState,
  workbenchUnsavedBufferDiff,
  workbenchUnsavedChangesMessage,
  removeWorkbenchArtifact,
  WORKBENCH_ASSISTANT_WIDTH,
  WORKBENCH_EXPLORER_WIDTH,
} from "../src/renderer/src/lib/workbench"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Workbench helpers", () => {
  test("normalizes parent paths for root and nested folders", () => {
    expect(workbenchParentPath("")).toBe("")
    expect(workbenchParentPath("src")).toBe("")
    expect(workbenchParentPath("src/renderer/")).toBe("src")
    expect(workbenchParentPath("src\\renderer\\components")).toBe("src/renderer")
  })

  test("builds project scopes as No Project plus one entry per project name", () => {
    const scopes = workbenchProjectScopes([
      {
        id: "project-1",
        name: "App",
        project: { name: "App", description: "" },
        folders: [{ path: "C:/work/app" }, { path: "C:/work/app-docs" }],
        time: { created: 1, updated: 1 },
      },
      {
        id: "project-2",
        name: "SDK",
        project: { name: "SDK", description: "" },
        folders: [{ path: "C:/work/sdk" }],
        time: { created: 1, updated: 1 },
      },
    ], "C:/work/opencodex")

    expect(scopes.map((scope) => scope.label)).toEqual(["No Project", "App", "SDK"])
    expect(scopes[1]?.directories).toEqual(["C:/work/app", "C:/work/app-docs"])
  })

  test("builds ancestor paths for revealing active files in the explorer", () => {
    expect(workbenchAncestorPaths("README.md")).toEqual([])
    expect(workbenchAncestorPaths(".\\src\\components\\editor.tsx")).toEqual(["src", "src/components"])
    expect(workbenchAncestorPaths("src/components/")).toEqual(["src"])
  })

  test("maps common workbench editor files to syntax modes", () => {
    expect(workbenchLanguageID("src/app.tsx")).toBe("javascript")
    expect(workbenchLanguageID("scripts/setup.sh")).toBe("shell")
    expect(workbenchLanguageID("scripts/install.ps1")).toBe("powershell")
    expect(workbenchLanguageID("Dockerfile")).toBe("dockerfile")
    expect(workbenchLanguageID("db/query.sql")).toBe("sql")
    expect(workbenchLanguageID("cmd/server.go")).toBe("go")
    expect(workbenchLanguageID("lib/task.rb")).toBe("ruby")
    expect(workbenchLanguageID("src/main.cpp")).toBe("cpp")
    expect(workbenchLanguageID(".env.local")).toBe("properties")
    expect(workbenchLanguageID("README")).toBe("plain")
  })

  test("seeds new file drafts from the current explorer folder", () => {
    expect(workbenchNewFileDraft({ folder: "src/components" })).toBe("src/components/")
    expect(workbenchNewFileDraft({ folder: "src\\components\\" })).toBe("src/components/")
    expect(workbenchNewFileDraft({ folder: "" })).toBe("")
    expect(workbenchNewFileDraft({ currentDraft: "src/app.tsx", folder: "src/components" })).toBe("src/app.tsx")
  })

  test("detects image binary previews and dirty state", () => {
    expect(isWorkbenchImageContent({
      type: "binary",
      content: "abc",
      encoding: "base64",
      mimeType: "image/png",
    })).toBe(true)
    expect(isWorkbenchImageContent({ type: "binary", content: "abc", encoding: "base64", mimeType: "application/pdf" })).toBe(false)
    expect(workbenchDirtyState({ current: "new", original: "old" })).toBe(true)
    expect(workbenchDirtyState({ current: "same", original: "same" })).toBe(false)
  })

  test("keeps editor buffer state across tab changes", () => {
    const buffers = upsertWorkbenchBuffer([
      { path: "src/app.tsx", content: "edited", original: "original" },
    ], {
      path: "src/util.ts",
      content: "util",
      original: "util",
    })

    expect(buffers.map((buffer) => buffer.path)).toEqual(["src/app.tsx", "src/util.ts"])
    expect(workbenchBufferDirty(buffers[0])).toBe(true)
    expect(workbenchBufferDirty(buffers[1])).toBe(false)

    expect(updateWorkbenchBuffer(buffers, "src/app.tsx", (buffer) => ({
      ...buffer,
      content: "next",
    })).find((buffer) => buffer.path === "src/app.tsx")?.content).toBe("next")
  })

  test("summarizes dirty editor buffers before destructive Workbench navigation", () => {
    const buffers = [
      { path: "src/app.tsx", content: "edited", original: "original" },
      { path: "src/util.ts", content: "util", original: "util" },
      { path: "README.md", content: "next", original: "old" },
      { path: "package.json", content: "next", original: "old" },
      { path: "bun.lock", content: "next", original: "old" },
      { path: "docs/notes.md", content: "next", original: "old" },
    ]

    expect(workbenchDirtyBufferPaths(buffers)).toEqual(["src/app.tsx", "README.md", "package.json", "bun.lock", "docs/notes.md"])
    expect([...workbenchDirtyPathSet(buffers)]).toEqual(["src/app.tsx", "README.md", "package.json", "bun.lock", "docs/notes.md"])
    expect(workbenchUnsavedChangesMessage(workbenchDirtyBufferPaths(buffers), "Switch projects?")).toBe([
      "You have unsaved changes in 5 files.",
      "",
      "src/app.tsx",
      "README.md",
      "package.json",
      "bun.lock",
      "...and 1 more",
      "",
      "Switch projects?",
    ].join("\n"))
    expect(workbenchUnsavedChangesMessage([], "Close?")).toBe("")
  })

  test("builds a reviewable diff from unsaved editor buffers", () => {
    const diff = workbenchUnsavedBufferDiff({
      path: ".\\src\\app.tsx",
      original: "const value = 1\nreturn value\noldOnly",
      content: "const value = 2\nreturn value\nnewOnly",
    })

    expect(diff).toEqual({
      file: "src/app.tsx",
      status: "modified",
      additions: 2,
      deletions: 2,
      patch: [
        "--- a/src/app.tsx",
        "+++ b/src/app.tsx",
        "@@ unsaved changes @@",
        "-const value = 1",
        "+const value = 2",
        " return value",
        "-oldOnly",
        "+newOnly",
      ].join("\n"),
    })
    expect(workbenchUnsavedBufferDiff({
      path: "src/app.tsx",
      original: "const value = 1\nreturn value",
      content: "const value = 1\n\nreturn value",
    })?.patch).toBe([
      "--- a/src/app.tsx",
      "+++ b/src/app.tsx",
      "@@ unsaved changes @@",
      " const value = 1",
      "+",
      " return value",
    ].join("\n"))
    expect(workbenchUnsavedBufferDiff({ path: "README.md", original: "same", content: "same" })).toBeUndefined()
  })

  test("renames and closes editor buffers without disturbing siblings", () => {
    const renamed = renameWorkbenchBuffer([
      { path: "src/app.tsx", content: "edited", original: "original" },
      { path: "src/util.ts", content: "util", original: "util" },
    ], "src/app.tsx", "src/main.tsx")

    expect(renamed.map((buffer) => buffer.path)).toEqual(["src/main.tsx", "src/util.ts"])

    expect(closeWorkbenchBuffer(renamed, "src/main.tsx", "src/main.tsx")).toEqual({
      buffers: [{ path: "src/util.ts", content: "util", original: "util" }],
      activePath: "src/util.ts",
    })
    expect(closeWorkbenchBuffer(renamed, "src/main.tsx", "src/util.ts")).toEqual({
      buffers: [{ path: "src/main.tsx", content: "edited", original: "original" }],
      activePath: "src/main.tsx",
    })
  })

  test("manages embedded browser tabs without losing active tab state", () => {
    const tabs = addWorkbenchBrowserTab([
      { id: "tab-1", url: "http://localhost:5173", title: "Localhost" },
    ], {
      id: "tab-2",
      url: "https://github.com/opencodex/app",
    })

    expect(tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"])
    expect(activeWorkbenchBrowserTab(tabs, "missing")?.id).toBe("tab-1")
    expect(workbenchBrowserTabLabel(tabs[1])).toBe("github.com")

    const navigated = updateWorkbenchBrowserTabState(tabs, {
      id: "tab-2",
      url: "https://github.com/opencodex/app/pulls",
      title: "Pull requests",
      canGoBack: true,
      canGoForward: false,
      loading: false,
    })

    expect(workbenchBrowserTabLabel(navigated[1])).toBe("Pull requests")
    expect(updateWorkbenchBrowserTabURL(navigated, "tab-2", "https://example.com")[1]?.url).toBe("https://example.com")
    expect(closeWorkbenchBrowserTab(navigated, "tab-2", "tab-2")).toEqual({
      tabs: [{ id: "tab-1", url: "http://localhost:5173", title: "Localhost" }],
      activeID: "tab-1",
    })
  })

  test("normalizes browser address bar input like a desktop browser", () => {
    expect(workbenchNormalizeBrowserURL("localhost:3000")).toBe("http://localhost:3000")
    expect(workbenchNormalizeBrowserURL("127.0.0.1:5173/workbench")).toBe("http://127.0.0.1:5173/workbench")
    expect(workbenchNormalizeBrowserURL("[::1]:5173")).toBe("http://[::1]:5173")
    expect(workbenchNormalizeBrowserURL("github.com/opencodex/app")).toBe("https://github.com/opencodex/app")
    expect(workbenchNormalizeBrowserURL("https://example.com")).toBe("https://example.com")
    expect(workbenchNormalizeBrowserURL("about:blank")).toBe("about:blank")
    expect(workbenchNormalizeBrowserURL("workbench polish")).toBe("https://www.google.com/search?q=workbench%20polish")
    expect(workbenchNormalizeBrowserURL("")).toBe("about:blank")
  })

  test("manages Workbench artifacts with dedupe, newest-first order, and caps", () => {
    const first = addWorkbenchArtifact([], {
      id: "note-1",
      kind: "note",
      title: "First note",
      text: "one",
      created: 1,
    })
    const replaced = addWorkbenchArtifact(first, {
      id: "note-1",
      kind: "note",
      title: "Updated note",
      text: "two",
      created: 2,
    })
    const capped = addWorkbenchArtifact(replaced, {
      id: "shot-1",
      kind: "screenshot",
      title: "Browser",
      url: "data:image/png;base64,abc",
      created: 3,
    }, 1)

    expect(replaced).toEqual([{
      id: "note-1",
      kind: "note",
      title: "Updated note",
      text: "two",
      created: 2,
    }])
    expect(capped.map((artifact) => artifact.id)).toEqual(["shot-1"])
    expect(removeWorkbenchArtifact(capped, "shot-1")).toEqual([])
    expect(workbenchBrowserPageArtifact({
      url: "https://github.com/opencodex/app/pulls",
      title: "Pull requests",
    })).toEqual({
      kind: "link",
      title: "Pull requests",
      url: "https://github.com/opencodex/app/pulls",
      text: "Browser page: Pull requests\nhttps://github.com/opencodex/app/pulls",
    })
    expect(workbenchBrowserPageArtifact({ url: "github.com/opencodex/app" })).toEqual({
      kind: "link",
      title: "github.com",
      url: "https://github.com/opencodex/app",
      text: "Browser page: github.com\nhttps://github.com/opencodex/app",
    })
    expect(workbenchBrowserPageArtifact({ url: " " })).toBeUndefined()
    expect(workbenchArtifactOpenURL({ kind: "link", url: "file:///C:/tmp/report.html" })).toBe("file:///C:/tmp/report.html")
    expect(workbenchArtifactOpenURL({ kind: "screenshot", url: "data:image/png;base64,abc" })).toBeUndefined()
    expect(workbenchArtifactOpenURL({ kind: "screenshot", url: "https://example.com/screenshot.png" })).toBe("https://example.com/screenshot.png")
  })

  test("ranks open-file options by file name before full path", () => {
    const options = workbenchOpenFileOptions({
      root: [
        { name: "index.ts", path: "packages/gui/src/index.ts", type: "file", absolute: "", ignored: false },
        { name: "gui.ts", path: "packages/index/gui.ts", type: "file", absolute: "", ignored: false },
        { name: "README.md", path: "docs/gui.md", type: "file", absolute: "", ignored: false },
      ],
      children: {},
      query: "gui",
    })

    expect(options.map((option) => option.path)).toEqual(["packages/index/gui.ts", "docs/gui.md", "packages/gui/src/index.ts"])
  })

  test("uses searched subdirectory matches for open-file options", () => {
    const options = workbenchOpenFileOptions({
      root: [],
      children: {},
      matches: [
        { name: "server.ts", path: "packages/gui/src/main/server.ts", type: "file", absolute: "", ignored: false },
        { name: "session-page.tsx", path: "packages/gui/src/renderer/src/components/session-page.tsx", type: "file", absolute: "", ignored: false },
      ],
      query: "session",
    })

    expect(options.map((option) => option.path)).toEqual(["packages/gui/src/renderer/src/components/session-page.tsx"])
  })

  test("persists assistant sessions with Workbench state", () => {
    const storage = new MemoryStorage()
    writeWorkbenchState({
      tab: "files",
      explorerCollapsed: false,
      explorerWidth: 310,
      assistantOpen: true,
      assistantWidth: 420,
      assistantSessions: { "workspace:C:/repo": "ses_1" },
      browserTabs: [],
      activeBrowserID: "",
      artifacts: [],
    }, storage)

    expect(readWorkbenchState(storage).assistantSessions).toEqual({ "workspace:C:/repo": "ses_1" })
  })

  test("persists bounded Workbench UI state for tabs, browser, and artifacts", () => {
    const storage = new MemoryStorage()

    writeWorkbenchState({
      tab: "browser",
      explorerCollapsed: true,
      explorerWidth: 900,
      assistantOpen: true,
      assistantWidth: 100,
      activeBrowserID: "tab-2",
      browserTabs: [
        { id: "tab-1", url: "localhost:5173", title: "Local" },
        { id: "tab-2", url: "github.com/opencodex/app", title: "GitHub" },
      ],
      artifacts: [
        { id: "note-1", kind: "note", title: "Diff note", text: "review this", created: 2 },
        { id: "link-1", kind: "link", title: "PRs", url: "https://github.com/opencodex/app/pulls", created: 1 },
        { id: "shot-1", kind: "screenshot", title: "Huge shot", url: `data:image/png;base64,${"a".repeat(200_001)}`, created: 3 },
      ],
    }, storage as Storage)

    expect(readWorkbenchState(storage as Storage)).toEqual({
      tab: "browser",
      explorerCollapsed: true,
      explorerWidth: WORKBENCH_EXPLORER_WIDTH.max,
      assistantOpen: true,
      assistantWidth: WORKBENCH_ASSISTANT_WIDTH.min,
      assistantSessions: {},
      activeBrowserID: "tab-2",
      browserTabs: [
        { id: "tab-1", url: "http://localhost:5173", title: "Local" },
        { id: "tab-2", url: "https://github.com/opencodex/app", title: "GitHub" },
      ],
      artifacts: [
        { id: "note-1", kind: "note", title: "Diff note", text: "review this", created: 2 },
        { id: "link-1", kind: "link", title: "PRs", url: "https://github.com/opencodex/app/pulls", created: 1 },
      ],
    })
  })

  test("ignores invalid persisted Workbench state", () => {
    expect(parseWorkbenchState("{")).toEqual({})
    expect(parseWorkbenchState(JSON.stringify({
      tab: "missing",
      activeBrowserID: "gone",
      explorerWidth: 12,
      assistantWidth: 10000,
      browserTabs: [{ id: "", url: "" }, { id: "tab-1", url: "workbench polish" }],
      artifacts: [{ id: "bad", kind: "note", title: "Empty note" }],
    }))).toEqual({
      explorerWidth: WORKBENCH_EXPLORER_WIDTH.min,
      assistantWidth: WORKBENCH_ASSISTANT_WIDTH.max,
      assistantSessions: {},
      activeBrowserID: "tab-1",
      browserTabs: [{ id: "tab-1", url: "https://www.google.com/search?q=workbench%20polish" }],
      artifacts: [],
    })
  })

  test("clamps resizable Workbench panes to useful editor widths", () => {
    expect(workbenchClampPaneWidth(undefined, WORKBENCH_EXPLORER_WIDTH)).toBe(WORKBENCH_EXPLORER_WIDTH.default)
    expect(workbenchClampPaneWidth(12, WORKBENCH_EXPLORER_WIDTH)).toBe(WORKBENCH_EXPLORER_WIDTH.min)
    expect(workbenchClampPaneWidth(9999, WORKBENCH_ASSISTANT_WIDTH)).toBe(WORKBENCH_ASSISTANT_WIDTH.max)
    expect(workbenchClampPaneWidth(337.6, WORKBENCH_ASSISTANT_WIDTH)).toBe(338)
  })

  test("routes workbench prompts to current sessions or pending new sessions", () => {
    expect(workbenchPromptTarget({ sessionID: "session-1", projectID: "project-1", projectDirectory: "C:/repo" })).toEqual({
      name: "session",
      sessionID: "session-1",
    })
    expect(workbenchPromptTarget({ projectID: "project-1", projectDirectory: "C:/repo/project", fallbackDirectory: "C:/repo" })).toEqual({
      name: "new-session",
      projectID: "project-1",
      directory: "C:/repo/project",
    })
    expect(workbenchPromptTarget({ fallbackDirectory: "C:/repo" })).toEqual({
      name: "new-session",
      projectID: undefined,
      directory: "C:/repo",
    })
  })

  test("builds GitHub browser links from only git remote metadata", () => {
    expect(workbenchGithubLinks({
      githubUrl: "https://github.com/opencodex/app.git/",
      branch: "feature/workbench",
      defaultBranch: "dev",
    })).toEqual({
      repository: "https://github.com/opencodex/app",
      pulls: "https://github.com/opencodex/app/pulls",
      issues: "https://github.com/opencodex/app/issues",
      actions: "https://github.com/opencodex/app/actions",
      compare: "https://github.com/opencodex/app/compare/dev...feature%2Fworkbench?quick_pull=1",
      newIssue: "https://github.com/opencodex/app/issues/new/choose",
    })
    expect(workbenchGithubLinks({
      githubUrl: "https://github.com/opencodex/app",
      branch: "dev",
      defaultBranch: "dev",
    })?.compare).toBe("https://github.com/opencodex/app/compare")
    expect(workbenchGithubLinks({ githubUrl: "https://gitlab.com/opencodex/app" })).toBeUndefined()
  })

  test("builds Git-only pull request checkout helpers without gh", () => {
    expect(workbenchPullNumber("12")).toBe(12)
    expect(workbenchPullNumber("#12")).toBe(12)
    expect(workbenchPullNumber("pull/12")).toBeUndefined()
    expect(workbenchPullNumber("0")).toBeUndefined()
    expect(workbenchGithubPullLink({
      githubUrl: "https://github.com/opencodex/app.git",
      number: 12,
    })).toBe("https://github.com/opencodex/app/pull/12")
    expect(workbenchGithubPullLink({
      githubUrl: "https://gitlab.com/opencodex/app",
      number: 12,
    })).toBeUndefined()
  })

  test("normalizes VCS diffs before matching changed file rows", () => {
    expect(workbenchPathKey(".\\src\\app.tsx")).toBe("src/app.tsx")
    const diffs = normalizeWorkbenchDiffs([
      { file: ".\\src\\app.tsx", patch: "@@", additions: 2, deletions: 1 },
      { file: "", patch: "@@", additions: 1, deletions: 0 },
    ] as DiffFile[])

    expect(diffs).toEqual([{
      file: "src/app.tsx",
      patch: "@@",
      additions: 2,
      deletions: 1,
      status: "modified",
    }])
    expect(workbenchDiffForPath(diffs, ".\\src\\app.tsx")?.patch).toBe("@@")
    expect(workbenchDiffForPath([
      { file: "packages/gui/src/app.tsx", patch: "prefixed", additions: 1, deletions: 0, status: "modified" },
    ], "src/app.tsx")?.patch).toBe("prefixed")
  })

  test("parses unified Git patches into visible addition and deletion rows", () => {
    expect(workbenchPatchRows([
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -10,3 +10,3 @@",
      " const same = true",
      "-const removed = true",
      "+const added = true",
    ].join("\n"))).toEqual([
      { kind: "meta", text: "diff --git a/src/app.ts b/src/app.ts" },
      { kind: "hunk", text: "@@ -10,3 +10,3 @@" },
      { kind: "context", text: "const same = true", oldLine: 10, newLine: 10 },
      { kind: "deletion", text: "const removed = true", oldLine: 11 },
      { kind: "addition", text: "const added = true", newLine: 11 },
    ])
  })

  test("builds Git change rows from status and sparse diff results", () => {
    const rows = workbenchGitChangeRows([
      { path: ".\\src\\app.tsx", code: " M", status: "modified", staged: false, unstaged: true, untracked: false },
    ], [
      { file: "src/app.tsx", patch: "@@ app", additions: 1, deletions: 1, status: "modified" },
      { file: "README.md", patch: "@@ readme", additions: 2, deletions: 0, status: "added" },
    ])

    expect(rows).toEqual([
      { path: "src/app.tsx", code: " M", status: "modified", staged: false, unstaged: true, untracked: false },
      { path: "README.md", code: "A ", status: "added", staged: false, unstaged: true, untracked: false },
    ])
  })

  test("filters and groups Git change rows for the Workbench triage list", () => {
    const rows = [
      { path: "src/app.tsx", code: "M ", status: "modified", staged: true, unstaged: false, untracked: false },
      { path: "README.md", code: " M", status: "modified", staged: false, unstaged: true, untracked: false },
      { path: "scripts/setup.sh", code: "??", status: "added", staged: false, unstaged: true, untracked: true },
    ]

    expect(workbenchFilteredGitChangeRows(rows, "src").map((file) => file.path)).toEqual(["src/app.tsx"])
    expect(workbenchFilteredGitChangeRows(rows, "new").map((file) => file.path)).toEqual(["scripts/setup.sh"])
    expect(workbenchFilteredGitChangeRows(rows, "staged").map((file) => file.path)).toEqual(["src/app.tsx"])
    expect(workbenchFilteredGitChangeRows(rows, "changes").map((file) => file.path)).toEqual(["README.md", "scripts/setup.sh"])
    expect(workbenchGitChangeGroups(rows)).toEqual({
      staged: [rows[0]],
      unstaged: [rows[1], rows[2]],
    })
  })

  test("summarizes Git changes from local status and text patch stats", () => {
    const rows = [
      { path: "src/app.tsx", code: "M ", status: "modified", staged: true, unstaged: false, untracked: false },
      { path: "README.md", code: " M", status: "modified", staged: false, unstaged: true, untracked: false },
      { path: "assets/logo.png", code: " M", status: "modified", staged: false, unstaged: true, untracked: false },
    ]
    const diffs = [
      { file: "src/app.tsx", patch: "@@", additions: 3, deletions: 1, status: "modified" },
      { file: "README.md", patch: "@@", additions: 2, deletions: 0, status: "modified" },
    ] as const

    expect(workbenchGitFileStats(rows[0], diffs[0])).toEqual({ additions: 3, deletions: 1, total: 4 })
    expect(workbenchGitFileStats(rows[2], undefined)).toEqual({ additions: 0, deletions: 0, total: 0 })
    expect(workbenchGitSummary(rows, diffs)).toEqual({
      changed: 3,
      staged: 1,
      unstaged: 2,
      additions: 5,
      deletions: 1,
    })
  })

  test("builds focused prompts from selected Git diffs", () => {
    expect(workbenchDiffPrompt({
      file: "src/app.tsx",
      status: "modified",
      additions: 4,
      deletions: 1,
      patch: "@@ -1 +1 @@\n-old\n+new",
    })).toContain("Review the Git diff for src/app.tsx (status: modified, +4, -1).")
    expect(workbenchDiffPrompt({
      file: "src/app.tsx",
      patch: "x".repeat(12_100),
    })).toContain("[Diff truncated]")
    expect(workbenchDiffPrompt({ file: "README.md" })).toBe("Review the Git diff for README.md. Call out risks, missing tests, and whether I should edit, stage, or discard it.")
  })

  test("builds current-file assistant prompts with selection and unsaved diff context", () => {
    const prompt = workbenchFileAssistantPrompt({
      question: "What should I improve?",
      path: "src/app.tsx",
      content: "export const value = 1",
      selection: "const value = 1",
      dirtyDiff: {
        additions: 1,
        deletions: 1,
        patch: "@@ unsaved changes @@\n-const value = 0\n+const value = 1",
      },
    })

    expect(prompt).toContain("What should I improve?")
    expect(prompt).toContain("Current file: src/app.tsx")
    expect(prompt).toContain("Selected text:")
    expect(prompt).toContain("Unsaved diff (+1 -1):")
    expect(prompt).toContain("Current file content:")
    expect(workbenchFileAssistantPrompt({ question: "Review workspace" })).toBe("Review workspace")
    expect(workbenchFileAssistantPrompt({ question: "", path: "README.md" })).toContain("Review this file and suggest the next best change.")
  })

  test("copies only available Git patch text", () => {
    expect(workbenchDiffCopyText({
      file: "src/app.tsx",
      patch: "@@ -1 +1 @@\n-old\n+new",
      additions: 1,
      deletions: 1,
      status: "modified",
    })).toBe("@@ -1 +1 @@\n-old\n+new")
    expect(workbenchDiffCopyText({ file: "README.md", status: "modified" })).toBe("")
    expect(workbenchDiffCopyText(undefined)).toBe("")
  })

  test("flattens expanded file trees like an accordion explorer", () => {
    const rows = flattenWorkbenchFileTree({
      root: [
        { name: "z.ts", path: "z.ts", absolute: "C:/repo/z.ts", type: "file", ignored: false },
        { name: "src", path: "src", absolute: "C:/repo/src", type: "directory", ignored: false },
      ],
      children: {
        src: [
          { name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false },
          { name: "components", path: "src/components", absolute: "C:/repo/src/components", type: "directory", ignored: false },
        ],
      },
      expanded: new Set(["src"]),
    })

    expect(rows.map((row) => [row.node.path, row.depth, row.expanded])).toEqual([
      ["src", 0, true],
      ["src/components", 1, false],
      ["src/app.tsx", 1, false],
      ["z.ts", 0, false],
    ])
  })

  test("filters file tree rows while preserving loaded parent folders", () => {
    const rows = flattenWorkbenchFileTree({
      root: [
        { name: "README.md", path: "README.md", absolute: "C:/repo/README.md", type: "file", ignored: false },
        { name: "src", path: "src", absolute: "C:/repo/src", type: "directory", ignored: false },
      ],
      children: {
        src: [
          { name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false },
          { name: "store.ts", path: "src/store.ts", absolute: "C:/repo/src/store.ts", type: "file", ignored: false },
        ],
      },
      expanded: new Set<string>(),
      filter: "app",
    })

    expect(rows.map((row) => [row.node.path, row.depth, row.expanded])).toEqual([
      ["src", 0, true],
      ["src/app.tsx", 1, false],
    ])
  })

  test("ranks direct open-file options from loaded tree and search matches", () => {
    const options = workbenchOpenFileOptions({
      root: [
        { name: "README.md", path: "README.md", absolute: "C:/repo/README.md", type: "file", ignored: false },
        { name: "src", path: "src", absolute: "C:/repo/src", type: "directory", ignored: false },
      ],
      children: {
        "": [
          { name: "README.md", path: "README.md", absolute: "C:/repo/README.md", type: "file", ignored: false },
          { name: "src", path: "src", absolute: "C:/repo/src", type: "directory", ignored: false },
        ],
        src: [
          { name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false },
          { name: "app.test.tsx", path: "src/app.test.tsx", absolute: "C:/repo/src/app.test.tsx", type: "file", ignored: false },
        ],
      },
      matches: [
        { name: "workbench-page.tsx", path: "packages/gui/src/components/workbench-page.tsx", absolute: "C:/repo/packages/gui/src/components/workbench-page.tsx", type: "file", ignored: false },
      ],
      query: "app",
    })

    expect(options.map((file) => file.path)).toEqual(["src/app.test.tsx", "src/app.tsx"])
    expect(workbenchOpenFileOptions({
      root: [],
      children: {},
      matches: [
        { name: "workbench-page.tsx", path: ".\\packages\\gui\\src\\components\\workbench-page.tsx", absolute: "C:/repo/packages/gui/src/components/workbench-page.tsx", type: "file", ignored: false },
      ],
      query: "packages/gui",
    }).map((file) => file.path)).toEqual(["packages/gui/src/components/workbench-page.tsx"])
  })

  test("marks changed editor lines and highlights code tokens", () => {
    expect(workbenchLineStates({
      original: "const value = 1\nreturn value",
      current: "const value = 2\nreturn value",
    }).map((line) => line.modified)).toEqual([true, false])
    expect(workbenchLineStates({
      original: "const value = 1\nreturn value",
      current: "const value = 1\n\nreturn value",
    }).map((line) => line.modified)).toEqual([false, true, false])

    const html = highlightWorkbenchCode({ path: "src/app.tsx", text: "const value = true // note" })
    expect(html).toContain("syntax-keyword")
    expect(html).toContain("syntax-primitive")
    expect(html).toContain("syntax-comment")
  })
})

describe("Workbench store wrappers", () => {
  test("uses existing file list and read APIs", async () => {
    const calls: string[] = []
    const gui = fakeWorkbenchGui(calls)

    expect(await listWorkbenchFiles(gui, "src")).toEqual([{ name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false }])
    expect(await readWorkbenchFile(gui, "src/app.tsx")).toEqual({ type: "text", content: "hello" })
    expect(await findFiles(gui, { query: "app", directory: "C:/repo/project", limit: 40 })).toEqual([
      { name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false },
    ])

    expect(calls).toContain("file.list:src:C:/repo")
    expect(calls).toContain("file.read:src/app.tsx:C:/repo")
    expect(calls).toContain("find.files:app:C:/repo/project:40")
  })

  test("routes file mutations through experimental workbench endpoints", async () => {
    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = []
    globalThis.fetch = fetchRecorder(calls, { ok: true, message: "Done." })
    const gui = fakeWorkbenchGui([])

    await writeWorkbenchFile(gui, { path: "src/app.tsx", content: "next", previousContent: "old" })
    await createWorkbenchFile(gui, { path: "src/new.ts", content: "" })
    await createWorkbenchFile(gui, { path: "src/components", directory: true })
    await renameWorkbenchFile(gui, { from: "src/new.ts", to: "src/newer.ts" })
    await deleteWorkbenchFile(gui, "src/newer.ts")

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/experimental/opencodex/workbench/file/write",
      "/experimental/opencodex/workbench/file/create",
      "/experimental/opencodex/workbench/file/create",
      "/experimental/opencodex/workbench/file/rename",
      "/experimental/opencodex/workbench/file/delete",
    ])
    expect(calls.every((call) => new URL(call.url).searchParams.get("directory") === "C:/repo")).toBe(true)
    expect(calls.every((call) => call.method === "POST")).toBe(true)
    expect(calls[0]?.body).toBe(JSON.stringify({ path: "src/app.tsx", content: "next", previousContent: "old" }))
    expect(calls[2]?.body).toBe(JSON.stringify({ path: "src/components", directory: true }))
    expect(calls[0]?.auth).toBe("Basic test")
  })

  test("routes Git and GitHub workbench operations with fixed endpoint names", async () => {
    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        auth: init?.headers instanceof Headers
          ? init.headers.get("authorization") ?? undefined
          : (init?.headers as Record<string, string> | undefined)?.authorization,
      })
      const pathname = new URL(url).pathname
      const data = pathname.endsWith("/git/status")
        ? { ok: true, branch: "feature/workbench", upstream: "origin/feature/workbench", ahead: 2, behind: 1, clean: true, files: [] }
        : pathname.endsWith("/git/branches")
          ? { ok: true, branches: ["dev"], current: "dev" }
          : pathname.endsWith("/git/diff")
            ? { ok: true, data: [{ file: "src/app.tsx", patch: "@@", additions: 1, deletions: 0, status: "modified" }] }
            : pathname.endsWith("/git/history")
              ? { ok: true, data: [{ hash: "abc123", shortHash: "abc123", author: "Test", date: "2026-06-13T00:00:00Z", subject: "Initial", files: [{ status: "M", path: "README.md" }] }] }
              : pathname.endsWith("/workbench/diagnostics")
                ? { ok: false, command: "bun run typecheck", message: "Project checks found issues.", diagnostics: [{ path: "src/app.ts", line: 1, column: 1, severity: "error", message: "TS1005: expected ;" }] }
                : pathname.endsWith("/git/stashes")
                  ? { ok: true, data: [{ ref: "stash@{0}", hash: "abc", age: "2 minutes ago", message: "WIP" }] }
                  : pathname.endsWith("/github/pulls")
                    ? { ok: true, data: [{ number: 1, title: "Preview" }] }
                    : { ok: true, message: "Done." }
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch
    const gui = fakeWorkbenchGui([])

    expect(await workbenchGitStatus(gui)).toEqual({ ok: true, branch: "feature/workbench", upstream: "origin/feature/workbench", ahead: 2, behind: 1, clean: true, files: [] })
    expect(await workbenchGitBranches(gui)).toEqual({ ok: true, branches: ["dev"], current: "dev" })
    expect(await workbenchGitDiff(gui)).toEqual({ ok: true, data: [{ file: "src/app.tsx", patch: "@@", additions: 1, deletions: 0, status: "modified" }] })
    expect(await workbenchGitHistory(gui)).toEqual({ ok: true, data: [{ hash: "abc123", shortHash: "abc123", author: "Test", date: "2026-06-13T00:00:00Z", subject: "Initial", files: [{ status: "M", path: "README.md" }] }] })
    expect(await workbenchDiagnostics(gui)).toEqual({ ok: false, command: "bun run typecheck", message: "Project checks found issues.", diagnostics: [{ path: "src/app.ts", line: 1, column: 1, severity: "error", message: "TS1005: expected ;" }] })
    await workbenchGitOperation(gui, "stage", { paths: ["src/app.tsx", "src/store.ts"] })
    await workbenchGitOperation(gui, "commit", { message: "feat(gui): add workbench", body: "Adds the first Workbench commit flow." })
    await workbenchGitOperation(gui, "publish")
    expect(await workbenchGitStashes(gui)).toEqual({ ok: true, data: [{ ref: "stash@{0}", hash: "abc", age: "2 minutes ago", message: "WIP" }] })
    await workbenchGitStashCreate(gui, { message: "Save before pull" })
    await workbenchGitStashOperation(gui, "apply", { ref: "stash@{0}" })
    await workbenchGitStashOperation(gui, "pop", { ref: "stash@{0}" })
    await workbenchGitStashOperation(gui, "drop", { ref: "stash@{0}" })
    expect(await workbenchGithubData(gui, "pulls")).toEqual({ ok: true, data: [{ number: 1, title: "Preview" }] })
    await workbenchGithubPost(gui, "checkout-pull", { number: 1 })
    await registerGuiBridge(gui, { browserBridge: { url: "http://127.0.0.1:4321", token: "secret" } })

    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ["GET", "/experimental/opencodex/workbench/git/status"],
      ["GET", "/experimental/opencodex/workbench/git/branches"],
      ["GET", "/experimental/opencodex/workbench/git/diff"],
      ["GET", "/experimental/opencodex/workbench/git/history"],
      ["GET", "/experimental/opencodex/workbench/diagnostics"],
      ["POST", "/experimental/opencodex/workbench/git/stage"],
      ["POST", "/experimental/opencodex/workbench/git/commit"],
      ["POST", "/experimental/opencodex/workbench/git/publish"],
      ["GET", "/experimental/opencodex/workbench/git/stashes"],
      ["POST", "/experimental/opencodex/workbench/git/stash"],
      ["POST", "/experimental/opencodex/workbench/git/stash/apply"],
      ["POST", "/experimental/opencodex/workbench/git/stash/pop"],
      ["POST", "/experimental/opencodex/workbench/git/stash/drop"],
      ["GET", "/experimental/opencodex/workbench/github/pulls"],
      ["POST", "/experimental/opencodex/workbench/github/checkout-pull"],
      ["POST", "/experimental/opencodex/gui-bridge/register"],
    ])
    expect(calls[5]?.body).toBe(JSON.stringify({ paths: ["src/app.tsx", "src/store.ts"] }))
    expect(calls[6]?.body).toBe(JSON.stringify({ message: "feat(gui): add workbench", body: "Adds the first Workbench commit flow." }))
    expect(calls[9]?.body).toBe(JSON.stringify({ message: "Save before pull" }))
    expect(calls[10]?.body).toBe(JSON.stringify({ ref: "stash@{0}" }))
    expect(calls[11]?.body).toBe(JSON.stringify({ ref: "stash@{0}" }))
    expect(calls[12]?.body).toBe(JSON.stringify({ ref: "stash@{0}" }))
    expect(calls[14]?.body).toBe(JSON.stringify({ number: 1 }))
    expect(calls[15]?.body).toBe(JSON.stringify({ browserBridge: { url: "http://127.0.0.1:4321", token: "secret" } }))
  })

  test("loads workbench diffs from the selected project directory", async () => {
    const calls: string[] = []
    const gui = {
      directory: "C:/repo",
      authHeader: "Basic test",
      client: {
        vcs: {
          diff: async (input: { directory?: string; mode: string; context?: number }) => {
            calls.push(`${input.mode}:${input.directory}:${input.context}`)
            return { data: [{ file: "src/app.tsx", patch: "@@", additions: 1, deletions: 0 }] }
          },
        },
      },
    } as unknown as GuiClient

    expect(await loadVcsDiff(gui, { mode: "git", context: 8, directory: "C:/repo/project" })).toEqual({
      data: [{ file: "src/app.tsx", patch: "@@", additions: 1, deletions: 0 }],
    })
    expect(calls).toEqual(["git:C:/repo/project:8"])
  })
})

function fakeWorkbenchGui(calls: string[]) {
  return {
    directory: "C:/repo",
    url: "http://127.0.0.1:4096",
    authHeader: "Basic test",
    client: {
      file: {
        list: async (input: { directory?: string; path: string }) => {
          calls.push(`file.list:${input.path}:${input.directory}`)
          return { data: [{ name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false }] }
        },
        read: async (input: { directory?: string; path: string }) => {
          calls.push(`file.read:${input.path}:${input.directory}`)
          return { data: { type: "text", content: "hello" } }
        },
      },
      find: {
        files: async (input: { directory?: string; query: string; limit?: number }) => {
          calls.push(`find.files:${input.query}:${input.directory}:${input.limit}`)
          return { data: [{ name: "app.tsx", path: "src/app.tsx", absolute: "C:/repo/src/app.tsx", type: "file", ignored: false }] }
        },
      },
    },
  } as unknown as GuiClient
}

function fetchRecorder(calls: Array<{ url: string; method: string; body?: string; auth?: string }>, payload: unknown) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      auth: init?.headers instanceof Headers
        ? init.headers.get("authorization") ?? undefined
        : (init?.headers as Record<string, string> | undefined)?.authorization,
    })
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

class MemoryStorage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}
