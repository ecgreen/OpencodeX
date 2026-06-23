import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  workbenchGitBranches,
  workbenchGitDiff,
  workbenchGitHistory,
  workbenchGitOperation,
  workbenchGitStashCreate,
  workbenchGitStashes,
  workbenchGitStashOperation,
  workbenchGitStatus,
  type DiffFile,
  type WorkbenchDataResult,
  type WorkbenchGitBranches,
  type WorkbenchGitHistoryCommit,
  type WorkbenchGitStash,
  type WorkbenchGitStatus,
  type WorkbenchOperationResult,
} from "../lib/store"
import {
  normalizeWorkbenchDiffs,
  workbenchDiffForPath,
  workbenchFilteredGitChangeRows,
  workbenchGitChangeGroups,
  workbenchGitChangeRows,
  workbenchPathKey,
  type WorkbenchDiffFile,
} from "../lib/workbench"
import { errorText, workbenchDiffsEqual } from "./workbench-page-helpers"

export function createWorkbenchGitController(input: {
  activeGui: Accessor<GuiClient | undefined>
  selectedDirectory: Accessor<string>
  confirm: (input: { title: string; message: string; confirm?: string }) => Promise<boolean>
  runOperation: (operation: () => Promise<WorkbenchOperationResult>) => Promise<WorkbenchOperationResult | undefined>
  setNotice: (message: string) => void
}) {
  const [status, setStatus] = createSignal<WorkbenchGitStatus>()
  const [branches, setBranches] = createSignal<WorkbenchGitBranches>()
  const [diffs, setDiffs] = createSignal<WorkbenchDiffFile[]>([])
  const [stashes, setStashes] = createSignal<WorkbenchGitStash[]>([])
  const [history, setHistory] = createSignal<WorkbenchGitHistoryCommit[]>([])
  const [loading, setLoading] = createSignal(false)
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [diffMessage, setDiffMessage] = createSignal("")
  const [filter, setFilter] = createSignal("")
  const [view, setView] = createSignal<"changes" | "history">("changes")
  const [selectedPath, setSelectedPath] = createSignal("")
  const [selectedHistoryHash, setSelectedHistoryHash] = createSignal("")
  const [branchName, setBranchName] = createSignal("")
  const [commitMessage, setCommitMessage] = createSignal("")
  const [commitBody, setCommitBody] = createSignal("")
  const [stashMessage, setStashMessage] = createSignal("")
  const allFiles = createMemo(() => workbenchGitChangeRows(status()?.files ?? [], diffs()))
  const selectedFiles = createMemo(() => workbenchFilteredGitChangeRows(allFiles(), filter()))
  const statusByPath = createMemo(() => new Map(allFiles().map((file) => [workbenchPathKey(file.path), file])))
  const selectedFile = createMemo(() => selectedFiles().find((file) => file.path === selectedPath()) ?? selectedFiles()[0])
  const selectedDiff = createMemo(() => workbenchDiffForPath(diffs(), selectedFile()?.path))
  const selectedHistoryCommit = createMemo(() => history().find((commit) => commit.hash === selectedHistoryHash()) ?? history()[0])
  const groups = createMemo(() => workbenchGitChangeGroups(allFiles()))
  const visibleGroups = createMemo(() => workbenchGitChangeGroups(selectedFiles()))
  const stagedFiles = createMemo(() => groups().staged)
  const visibleStagedFiles = createMemo(() => visibleGroups().staged)
  const visibleUnstagedFiles = createMemo(() => visibleGroups().unstaged)
  const visibleAllStaged = createMemo(() => selectedFiles().length > 0 && visibleUnstagedFiles().length === 0)
  const visibleSomeStaged = createMemo(() => visibleStagedFiles().length > 0 && visibleUnstagedFiles().length > 0)

  createEffect(() => {
    const selected = selectedPath()
    const files = selectedFiles()
    if (selected && files.some((file) => file.path === selected)) return
    setSelectedPath(files[0]?.path ?? "")
  })

  createEffect(() => {
    const selected = selectedHistoryHash()
    const commits = history()
    if (selected && commits.some((commit) => commit.hash === selected)) return
    setSelectedHistoryHash(commits[0]?.hash ?? "")
  })

  createEffect(() => {
    const current = status()?.branch ?? branches()?.current ?? ""
    if (!current || branchName()) return
    setBranchName(current)
  })

  async function refresh() {
    const gui = input.activeGui()
    if (!gui) return
    setLoading(true)
    setDiffLoading(true)
    setMessage("")
    try {
      const [nextStatus, branchList, diffResult, stashResult, historyResult] = await Promise.all([
        workbenchGitStatus(gui, input.selectedDirectory()).catch((err): WorkbenchGitStatus => ({ ok: false, clean: true, files: [], message: errorText(err, "Unable to load Git status.") })),
        workbenchGitBranches(gui, input.selectedDirectory()).catch((err): WorkbenchGitBranches => ({ ok: false, branches: [], message: errorText(err, "Unable to load branches.") })),
        workbenchGitDiff(gui, input.selectedDirectory())
          .catch((err): WorkbenchDataResult<DiffFile[]> => ({ ok: false, data: [], message: errorText(err, "Unable to load Git diffs.") })),
        workbenchGitStashes(gui, input.selectedDirectory()).catch((): WorkbenchDataResult<WorkbenchGitStash[]> => ({ ok: false, data: [] })),
        workbenchGitHistory(gui, input.selectedDirectory()).catch((err): WorkbenchDataResult<WorkbenchGitHistoryCommit[]> => ({ ok: false, data: [], message: errorText(err, "Unable to load Git history.") })),
      ])
      const nextDiffs = normalizeWorkbenchDiffs(diffResult.data ?? [])
      setStatus(nextStatus)
      setBranches(branchList)
      setDiffs((current) => workbenchDiffsEqual(current, nextDiffs) ? current : nextDiffs)
      setStashes(Array.isArray(stashResult.data) ? stashResult.data : [])
      setHistory(Array.isArray(historyResult.data) ? historyResult.data : [])
      setDiffMessage(diffResult.ok ? "" : diffResult.message ?? "Unable to load Git diffs.")
      setMessage([
        nextStatus.ok ? "" : nextStatus.message,
        branchList.ok ? "" : branchList.message,
        stashResult.ok ? "" : stashResult.message ?? "Unable to load stashes.",
        historyResult.ok ? "" : historyResult.message ?? "Unable to load Git history.",
      ].filter(Boolean).join(" "))
    } catch (err) {
      input.setNotice(errorText(err, "Failed to refresh Git status."))
    } finally {
      setLoading(false)
      setDiffLoading(false)
    }
  }

  async function runGit(action: "stage" | "unstage" | "discard", path: string) {
    const gui = input.activeGui()
    if (!gui) return
    if (action === "discard" && !(await input.confirm({
      title: "Discard Changes",
      message: `Discard changes in ${path}?\n\nThis cannot be undone from OpencodeX.`,
      confirm: "Discard",
    }))) return
    await input.runOperation(() => workbenchGitOperation(gui, action, { paths: [path] }, input.selectedDirectory()))
    void refresh()
  }

  async function runGitForPaths(action: "stage" | "unstage", paths: string[]) {
    const gui = input.activeGui()
    if (!gui || paths.length === 0) return
    await input.runOperation(() => workbenchGitOperation(gui, action, { paths }, input.selectedDirectory()))
    void refresh()
  }

  function toggleVisibleSelection() {
    const action = visibleAllStaged() ? "unstage" : "stage"
    const paths = (action === "stage" ? visibleUnstagedFiles() : visibleStagedFiles()).map((file) => file.path)
    void runGitForPaths(action, paths)
  }

  async function checkoutBranch(nextBranch = branchName().trim()) {
    const gui = input.activeGui()
    if (!gui || !nextBranch.trim()) return
    await input.runOperation(() => workbenchGitOperation(gui, "checkout", { branch: nextBranch.trim() }, input.selectedDirectory()))
    void refresh()
  }

  async function createBranch() {
    const gui = input.activeGui()
    if (!gui || !branchName().trim()) return
    await input.runOperation(() => workbenchGitOperation(gui, "create-branch", { branch: branchName().trim() }, input.selectedDirectory()))
    setBranchName("")
    void refresh()
  }

  async function commit() {
    const gui = input.activeGui()
    if (!gui || !commitMessage().trim()) return
    const body = commitBody().trim()
    const result = await input.runOperation(() => workbenchGitOperation(gui, "commit", {
      message: commitMessage().trim(),
      ...(body ? { body } : {}),
    }, input.selectedDirectory()))
    if (result?.ok) {
      setCommitMessage("")
      setCommitBody("")
    }
    void refresh()
  }

  async function createStash() {
    const gui = input.activeGui()
    if (!gui || selectedFiles().length === 0) return
    const message = stashMessage().trim()
    const result = await input.runOperation(() => workbenchGitStashCreate(gui, {
      ...(message ? { message } : {}),
    }, input.selectedDirectory()))
    if (result?.ok) setStashMessage("")
    void refresh()
  }

  async function runStash(action: "apply" | "pop" | "drop", ref: string) {
    const gui = input.activeGui()
    if (!gui) return
    if (action === "drop" && !(await input.confirm({
      title: "Drop Stash",
      message: `Drop ${ref}?\n\nThis permanently removes the stash entry.`,
      confirm: "Drop",
    }))) return
    await input.runOperation(() => workbenchGitStashOperation(gui, action, { ref }, input.selectedDirectory()))
    void refresh()
  }

  async function runRemote(action: "fetch" | "pull" | "push" | "publish") {
    const gui = input.activeGui()
    if (!gui) return
    await input.runOperation(() => workbenchGitOperation(gui, action, undefined, input.selectedDirectory()))
    void refresh()
  }

  return {
    status,
    branches,
    diffs,
    stashes,
    history,
    loading,
    diffLoading,
    message,
    diffMessage,
    filter,
    setFilter,
    view,
    setView,
    selectedFile,
    selectedDiff,
    selectedHistoryCommit,
    stagedFiles,
    visibleStagedFiles,
    visibleUnstagedFiles,
    visibleAllStaged,
    visibleSomeStaged,
    selectedFiles,
    allFiles,
    statusByPath,
    branchName,
    setBranchName,
    commitMessage,
    setCommitMessage,
    commitBody,
    setCommitBody,
    stashMessage,
    setStashMessage,
    setSelectedPath,
    setSelectedHistoryHash,
    refresh,
    runGit,
    toggleVisibleSelection,
    checkoutBranch,
    createBranch,
    commit,
    createStash,
    runStash,
    runRemote,
    reset: () => {
      setLoading(false)
      setDiffLoading(false)
      setMessage("")
      setDiffMessage("")
      setFilter("")
      setHistory([])
      setView("changes")
      setSelectedHistoryHash("")
    },
  }
}
