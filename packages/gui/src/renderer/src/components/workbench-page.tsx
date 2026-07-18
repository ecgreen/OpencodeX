import { findFiles } from "../lib/store"
import {
  readWorkbenchState,
  writeWorkbenchState,
  removeWorkbenchArtifact,
  type WorkbenchArtifact,
  type WorkbenchTab,
} from "../lib/workbench"
import { Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createWorkbenchAssistantController } from "./workbench-assistant-controller"
import { createWorkbenchBrowserController } from "./workbench-browser-controller"
import { createWorkbenchContextController } from "./workbench-context-controller"
import { createWorkbenchDiagnosticsController } from "./workbench-diagnostics-controller"
import { createWorkbenchFileController } from "./workbench-file-controller"
import { createWorkbenchGitController } from "./workbench-git-controller"
import { createWorkbenchLayoutController } from "./workbench-layout-controller"
import { WorkbenchArtifactsPanel } from "./workbench-artifacts-panel"
import { WorkbenchBrowserPanel } from "./workbench-browser-panel"
import { WorkbenchFilesTab } from "./workbench-files-tab"
import { WorkbenchGitPanel } from "./workbench-git-panel"
import { WorkbenchTabs } from "./workbench-tabs"
import { assistantSessionModel, gitStatusSymbol, newBrowserID } from "./workbench-page-helpers"
import type { WorkbenchPageProps } from "./workbench-page-types"
import { createWorkbenchOperationController } from "./workbench-operation-controller"

export function WorkbenchPage(props: WorkbenchPageProps) {
  const persistedWorkbench = readWorkbenchState()
  const fallbackBrowserID = newBrowserID()
  const initialBrowserTabs = persistedWorkbench.browserTabs?.length
    ? persistedWorkbench.browserTabs
    : [{ id: fallbackBrowserID, url: "", title: "New tab" }]
  const [tab, setTab] = createSignal<WorkbenchTab>(persistedWorkbench.tab ?? "files")
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal("")
  const [artifacts, setArtifacts] = createSignal<WorkbenchArtifact[]>(persistedWorkbench.artifacts ?? [])
  const { confirmWorkbench, runOperation } = createWorkbenchOperationController({ confirm: props.confirm, setBusy, setNotice })
  const layout = createWorkbenchLayoutController(persistedWorkbench)
  const files = createWorkbenchFileController({ props, setNotice, setBusy, runOperation })
  const browser = createWorkbenchBrowserController({
    active: () => tab() === "browser",
    initialTabs: initialBrowserTabs,
    initialActiveID: persistedWorkbench.activeBrowserID ?? initialBrowserTabs[0]?.id ?? fallbackBrowserID,
    setArtifacts,
    setNotice,
    setTab,
  })
  const git = createWorkbenchGitController({
    activeGui: files.activeGui,
    selectedDirectory: files.selectedDirectory,
    confirm: confirmWorkbench,
    runOperation,
    setNotice,
  })
  const gitStatus = git.status
  const branches = git.branches
  const gitDiffs = git.diffs
  const gitStashes = git.stashes
  const gitHistory = git.history
  const gitLoading = git.loading
  const gitDiffLoading = git.diffLoading
  const gitMessage = git.message
  const gitDiffMessage = git.diffMessage
  const gitFilter = git.filter
  const setGitFilter = git.setFilter
  const gitView = git.view
  const setGitView = git.setView
  const selectedGitFile = git.selectedFile
  const selectedGitDiff = git.selectedDiff
  const selectedHistoryCommit = git.selectedHistoryCommit
  const stagedGitFiles = git.stagedFiles
  const visibleStagedGitFiles = git.visibleStagedFiles
  const visibleUnstagedGitFiles = git.visibleUnstagedFiles
  const visibleGitAllStaged = git.visibleAllStaged
  const visibleGitSomeStaged = git.visibleSomeStaged
  const selectedGitFiles = git.selectedFiles
  const allGitFiles = git.allFiles
  const gitStatusByPath = git.statusByPath
  const branchName = git.branchName
  const setBranchName = git.setBranchName
  const commitMessage = git.commitMessage
  const setCommitMessage = git.setCommitMessage
  const commitBody = git.commitBody
  const setCommitBody = git.setCommitBody
  const stashMessage = git.stashMessage
  const setStashMessage = git.setStashMessage
  const assistant = createWorkbenchAssistantController({
    props,
    activeGui: files.activeGui,
    selectedProject: files.selectedProject,
    selectedDirectory: files.selectedDirectory,
    activeBuffer: files.activeBuffer,
    editorSelection: files.editorSelection,
    initialSessions: persistedWorkbench.assistantSessions ?? {},
    setNotice,
  })
  const assistantSession = assistant.session
  const assistantData = assistant.data
  const assistantLoading = assistant.loading
  const assistantPermissions = assistant.permissions
  const assistantQuestions = assistant.questions
  const assistantComposer = assistant.composer
  const diagnosticState = createWorkbenchDiagnosticsController({
    gui: files.activeGui,
    directory: files.selectedDirectory,
    path: files.openPath,
  })
  const context = createWorkbenchContextController({
    props,
    path: files.openPath,
    buffer: files.activeBuffer,
    selection: files.editorSelection,
    diagnosticsCommand: diagnosticState.command,
    setArtifacts,
    setNotice,
  })
  onMount(() => {
    const syncOnFocus = () => {
      if (tab() === "files") void files.syncLoadedFileFolders()
      if (tab() === "git") void git.refresh()
    }
    window.addEventListener("focus", syncOnFocus)
    onCleanup(() => window.removeEventListener("focus", syncOnFocus))
  })

  createEffect(() => {
    if (!files.scopeRevision()) return
    setCommitMessage("")
    setCommitBody("")
    setStashMessage("")
    git.reset()
    void git.refresh()
  })

  createEffect(() => {
    if (!files.mutationRevision()) return
    void git.refresh()
    void diagnosticState.refresh()
  })

  createEffect(() => {
    if (!layout.assistantOpen() || tab() !== "files") return
    void assistant.ensureSession()
  })

  createEffect(() => {
    if (tab() !== "browser") {
      browser.hideTabs()
      return
    }
    void browser.showActive()
  })

  createEffect(() => {
    if (tab() !== "git" || !files.activeGui() || !files.selectedDirectory()) return
    queueMicrotask(() => void git.refresh())
  })

  createEffect(() => {
    writeWorkbenchState({
      tab: tab(),
      explorerCollapsed: layout.explorerCollapsed(),
      explorerWidth: layout.explorerWidth(),
      assistantOpen: layout.assistantOpen(),
      assistantWidth: layout.assistantWidth(),
      assistantSessions: assistant.sessions(),
      browserTabs: browser.tabs(),
      activeBrowserID: browser.activeID(),
      artifacts: artifacts(),
    })
  })

  return (
    <section class="page workbench-page">
      <WorkbenchTabs tab={tab} setTab={setTab} />

      <Show when={notice()}>
        <div class="notice">{notice()}</div>
      </Show>

      <Switch>
        <Match when={tab() === "files"}>
          <WorkbenchFilesTab
            explorerCollapsed={layout.explorerCollapsed}
            assistantOpen={layout.assistantOpen}
            explorerWidth={layout.explorerWidth}
            assistantWidth={layout.assistantWidth}
            startPaneResize={layout.startResize}
            explorer={{
              collapsed: layout.explorerCollapsed,
              setCollapsed: layout.setExplorerCollapsed,
              canUseWorkspace: () => !!files.activeGui() && !!files.selectedDirectory(),
              selectedDirectory: files.selectedDirectory,
              startNewFile: files.startNewFile,
              startNewFolder: files.startNewFolder,
              projectOptions: files.projectOptions,
              selectedProjectID: files.selectedProjectID,
              selectProject: (value) => void files.selectProject(value),
              filter: files.explorerFilter,
              setFilter: files.setExplorerFilter,
              openFilePalette: files.openFilePalette,
              newFilePath: files.newFilePath,
              newItemKind: files.newItemKind,
              setNewFilePath: files.setNewFilePath,
              filePath: files.filePath,
              setNewFileInput: files.setNewFileInput,
              createExplorerItem: () => void files.createItem(),
              searchState: files.explorerSearchState,
              matches: files.explorerMatches,
              openPath: files.openPath,
              dirtyPaths: files.dirtyPaths,
              gitStatusByPath,
              toggleFolder: (node) => void files.toggleFolder(node),
              openFile: (path) => void files.openFile(path),
              rows: files.fileTreeRows,
              busy,
              gitStatusSymbol,
            }}
            editor={{
              buffers: files.buffers,
              activePath: files.activePath,
              openPath: files.openPath,
              dirty: files.dirty,
              activeBuffer: files.activeBuffer,
              fileContent: files.fileContent,
              activeDiagnostics: diagnosticState.active,
              diagnostics: diagnosticState.diagnostics,
              diagnosticsLoading: diagnosticState.loading,
              diagnosticsMessage: diagnosticState.message,
              diagnosticsCommand: diagnosticState.command,
              runDiagnostics: () => void diagnosticState.refresh(),
              gitStatusByPath,
              setActivePath: files.setActivePath,
              revealFile: (path) => void files.revealFile(path),
              closeBuffer: (buffer) => void files.closeBuffer(buffer),
              revertFile: files.revertFile,
              saveFile: () => void files.saveFile(),
              sendContext: context.promptFile,
              askAboutEdits: context.promptUnsavedDiff,
              saveArtifact: context.saveFileArtifact,
              saveEditsArtifact: context.saveUnsavedDiffArtifact,
              renameFile: () => void files.renameFile(),
              deleteFile: () => void files.deleteFile(),
              assistantOpen: layout.assistantOpen,
              setAssistantOpen: layout.setAssistantOpen,
              openDiagnostic: (path) => void files.openFile(path),
              fixDiagnostic: context.promptDiagnosticFix,
              changeBuffer: files.changeBuffer,
              saveActiveFile: () => void files.saveFile(),
              setEditorSelection: files.setEditorSelection,
              gitStatusSymbol,
            }}
            assistant={{
              session: assistantSession(),
              data: assistantData(),
              loading: assistantLoading(),
              contextPath: files.openPath(),
              contextLabel: files.selectedProject()?.label ?? "Workspace",
              close: () => layout.setAssistantOpen(false),
              sessionPage: {
                prompt: "",
                setPrompt: assistant.restorePrompt,
                providers: props.snapshot?.providers ?? [],
                mcp: props.snapshot?.mcp ?? {},
                mcpResources: props.snapshot?.mcpResources ?? {},
                lsp: props.snapshot?.lsp ?? [],
                config: props.snapshot?.config,
                agents: props.snapshot?.agents ?? [],
                findFiles: (input) => files.activeGui() ? findFiles(files.activeGui()!, input) : Promise.resolve([]),
                selectedAgent: props.selectedAgent ?? assistantSession()?.agent ?? "",
                setSelectedAgent: props.setSelectedAgent ?? (() => {}),
                selectedModel: props.selectedModel ?? (assistantSession() ? assistantSessionModel(assistantSession()!) : ""),
                recentModels: props.recentModels ?? [],
                setSelectedModel: props.setSelectedModel ?? (() => {}),
                selectedVariant: props.selectedVariant ?? "",
                setSelectedVariant: props.setSelectedVariant ?? (() => {}),
                submit: (event, prompt) => void assistant.submit(event, prompt),
                permissions: assistantPermissions(),
                questions: assistantQuestions(),
                replyPermission: (request, reply) => props.replyPermission?.(request, reply),
                replyQuestion: (request, answers) => props.replyQuestion?.(request, answers),
                rejectQuestion: (request) => props.rejectQuestion?.(request),
                renameSession: props.renameSession ?? (() => {}),
                moveSession: props.moveSession ?? (() => {}),
                deleteSession: props.deleteSession ?? (() => {}),
                slashCommands: assistantSession() ? props.slashCommands?.(assistantSession()!, assistantData(), assistant.restorePrompt) ?? [] : [],
                showTimestamps: props.showTimestamps ?? false,
                showThinking: props.showThinking ?? true,
                showToolDetails: props.showToolDetails ?? true,
                showScrollbar: props.showScrollbar ?? true,
                showGenericToolOutput: props.showGenericToolOutput ?? true,
                toggleTimestamps: props.toggleTimestamps ?? (() => {}),
                toggleThinking: props.toggleThinking ?? (() => {}),
                toggleToolDetails: props.toggleToolDetails ?? (() => {}),
                toggleScrollbar: props.toggleScrollbar ?? (() => {}),
                toggleGenericToolOutput: props.toggleGenericToolOutput ?? (() => {}),
                status: assistantSession() ? props.snapshot?.sessionStatus[assistantSession()!.id]?.type : undefined,
                composerState: assistantComposer(),
                updateComposerState: assistant.updateComposer,
                loadOlderMessages: (cursor) => assistantSession() ? assistant.load(assistantSession()!, cursor) : Promise.resolve(),
              },
            }}
            openFileModalOpen={files.openFileModalOpen}
            openFileModal={{
              projectLabel: files.selectedProject()?.label ?? "Workspace",
              query: files.openFileQuery(),
              searchState: files.openFileSearchState(),
              options: files.openFileOptions(),
              close: () => files.setOpenFileModalOpen(false),
              setQuery: files.setOpenFileQuery,
              openFile: (path) => void files.openDirectFile(path),
            }}
          />
        </Match>

        <Match when={tab() === "git"}>
          <WorkbenchGitPanel
            active={!!files.activeGui()}
            status={gitStatus}
            branches={branches}
            branchName={branchName}
            setBranchName={setBranchName}
            checkoutBranch={(branch) => void git.checkoutBranch(branch)}
            runRemoteGit={(action) => void git.runRemote(action)}
            createBranch={() => void git.createBranch()}
            view={gitView}
            setView={setGitView}
            filter={gitFilter}
            setFilter={setGitFilter}
            allFileCount={() => allGitFiles().length}
            message={gitMessage}
            selectedFiles={selectedGitFiles}
            loading={gitLoading}
            allVisibleStaged={visibleGitAllStaged}
            someVisibleStaged={visibleGitSomeStaged}
            toggleVisibleSelection={git.toggleVisibleSelection}
            stagedFiles={visibleStagedGitFiles}
            unstagedFiles={visibleUnstagedGitFiles}
            diffs={gitDiffs}
            selectFile={git.setSelectedPath}
            runGit={(action, path) => void git.runGit(action, path)}
            commitMessage={commitMessage}
            setCommitMessage={setCommitMessage}
            commitBody={commitBody}
            setCommitBody={setCommitBody}
            stagedCount={() => stagedGitFiles().length}
            commit={() => void git.commit()}
            history={gitHistory}
            selectedCommit={selectedHistoryCommit}
            selectCommit={git.setSelectedHistoryHash}
            stashes={gitStashes}
            stashMessage={stashMessage}
            setStashMessage={setStashMessage}
            createStash={() => void git.createStash()}
            runStash={(action, ref) => void git.runStash(action, ref)}
            selectedFile={selectedGitFile}
            diffMessage={gitDiffMessage}
            selectedDiff={selectedGitDiff}
            diffLoading={gitDiffLoading}
          />
        </Match>

        <Match when={tab() === "browser"}>
          <WorkbenchBrowserPanel
            tabs={browser.tabs()}
            activeID={browser.activeID()}
            state={browser.state()}
            available={Boolean(window.opencodex?.browser)}
            lifecycle={browser.lifecycle()}
            error={browser.error()}
            url={browser.url()}
            setActiveID={browser.setActiveID}
            closeTab={browser.closeTab}
            createTab={() => browser.createTab()}
            setURL={browser.setURL}
            navigate={() => void browser.navigate()}
            action={(action) => void browser.action(action)}
            captureScreenshot={() => void browser.captureScreenshot()}
            savePage={browser.savePageArtifact}
            askAgent={() => context.prompt(`Look at the embedded browser page ${browser.state()?.url || browser.url()}. Tell me what to test next and what UI issues to watch for.`)}
            openDevtools={() => void window.opencodex?.browser?.devtools(browser.id())}
            setHost={browser.setHost}
          />
        </Match>

        <Match when={tab() === "artifacts"}>
          <WorkbenchArtifactsPanel
            artifacts={artifacts()}
            setTab={setTab}
            promptArtifact={context.promptArtifact}
            openURL={browser.openURL}
            clear={() => setArtifacts([])}
            deleteArtifact={(id) => setArtifacts((items) => removeWorkbenchArtifact(items, id))}
          />
        </Match>
      </Switch>
    </section>
  )
}
