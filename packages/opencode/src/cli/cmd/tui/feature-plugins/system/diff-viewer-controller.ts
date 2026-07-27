import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { updateClientSessionState } from "@opencode-ai/sdk/v2"
import type { BorderSides, BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { useSync } from "@tui/context/sync"
import { getScrollAcceleration } from "@tui/util/scroll"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  setFileTreeDirectoryExpanded,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
  type FileTreeRow,
} from "./diff-viewer-file-tree-utils"
import {
  DIFF_CONTEXT_LINES,
  DIFF_KV_SHOW_FILE_TREE,
  DIFF_KV_SINGLE_PATCH,
  DIFF_KV_VIEW,
  DIFF_MIN_SPLIT_WIDTH,
  type DiffParams,
  type DiffView,
  type DiffViewerFocus,
  normalizeDiffs,
  storedDiffView,
} from "./diff-viewer-model"

export function createDiffViewerController(api: TuiPluginApi) {
  const dimensions = useTerminalDimensions()
  const sync = useSync()
  const params = () =>
    ("params" in api.route.current ? api.route.current.params : undefined) as DiffParams | undefined
  const mode = () => params()?.mode ?? "git"
  const sessionID = () => params()?.sessionID
  const [diff] = createResource(
    createMemo(() => ({ mode: mode(), sessionID: sessionID(), messageID: params()?.messageID })),
    async (input) => {
      if (input.mode === "last-turn") {
        if (!input.sessionID) return []
        const result = await api.client.session.diff(
          { sessionID: input.sessionID, messageID: input.messageID },
          { throwOnError: true },
        )
        return normalizeDiffs(result.data ?? [])
      }
      const result = await api.client.vcs.diff(
        { mode: "git", context: DIFF_CONTEXT_LINES },
        { throwOnError: true },
      )
      return normalizeDiffs(result.data ?? [])
    },
  )
  const files = createMemo(() => diff() ?? [])
  const [focus, setFocus] = createSignal<DiffViewerFocus>("patches")
  const [fileTreeEnabled, setFileTreeEnabled] = createSignal(api.kv.get<boolean>(DIFF_KV_SHOW_FILE_TREE, true) !== false)
  const showFileTree = createMemo(() => showDiffViewerFileTree(fileTreeEnabled(), files().length))
  const [singlePatch, setSinglePatch] = createSignal(api.kv.get<boolean>(DIFF_KV_SINGLE_PATCH, false) === true)
  const patchPaneWidth = createMemo(() => dimensions().width - (showFileTree() ? 33 : 0) - 4)
  const patchLeftBorder = createMemo<BorderSides[]>(() => (showFileTree() ? ["left"] : []))
  const splitAvailable = createMemo(() => patchPaneWidth() >= DIFF_MIN_SPLIT_WIDTH)
  const defaultView = createMemo(() => {
    if (api.tuiConfig.diff_style === "stacked") return "unified"
    return splitAvailable() ? "split" : "unified"
  })
  const [viewOverride, setViewOverride] = createSignal<DiffView | undefined>(storedDiffView(api.kv.get(DIFF_KV_VIEW)))
  const view = createMemo(() => (splitAvailable() ? (viewOverride() ?? defaultView()) : "unified"))
  const fileTree = createMemo(() => buildFileTree(files()))
  const [expandedFileNodes, setExpandedFileNodes] = createSignal<ReadonlySet<number>>(new Set())
  const [highlightedFileNode, setHighlightedFileNode] = createSignal<number | undefined>()
  const [lastHighlightedFileNode, setLastHighlightedFileNode] = createSignal<number | undefined>()
  const [activePatchFileIndex, setActivePatchFileIndex] = createSignal<number | undefined>()
  const [selectedFileIndex, setSelectedFileIndex] = createSignal<number | undefined>()
  const [reviewedFileNames, setReviewedFileNames] = createSignal<ReadonlySet<string>>(new Set())
  const fileRows = createMemo(() => flattenFileTree(fileTree(), expandedFileNodes()))
  const patchFileIndexes = createMemo(() => orderedPatchFileIndexes(flattenFileTree(fileTree())))
  const [pendingPatchScrollFileIndex, setPendingPatchScrollFileIndex] = createSignal<number | undefined>()
  const [patchFillerHeight, setPatchFillerHeight] = createSignal(0)
  const patchNodeByFileIndex = new Map<number, BoxRenderable>()
  const frames = new Set<number>()
  let scroll: ScrollBoxRenderable | undefined
  let measureFrame: number | undefined

  const frame = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      fn()
    })
    frames.add(id)
    return id
  }

  onCleanup(() => {
    frames.forEach((id) => cancelAnimationFrame(id))
    frames.clear()
    patchNodeByFileIndex.clear()
    api.ui.dialog.clear()
  })

  createEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
    setHighlightedFileNode(undefined)
    setLastHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedFileIndex(undefined)
    const currentReviewed = sync.data.session_ui_state[sessionID() ?? ""]?.reviewedFiles ?? []
    const currentFiles = new Set(files().map((file) => file.file))
    setReviewedFileNames(new Set(currentReviewed.filter((file) => currentFiles.has(file))))
  })

  const setHighlighted = (node: number | undefined) => {
    setHighlightedFileNode(node)
    if (node !== undefined) setLastHighlightedFileNode(node)
  }

  const ensureHighlightedFileNode = () => {
    const highlighted = highlightedFileNode()
    if (highlighted !== undefined && fileRows().some((row) => row.id === highlighted)) return
    const last = lastHighlightedFileNode()
    setHighlighted(
      last !== undefined && fileRows().some((row) => row.id === last)
        ? last
        : fileRows().find((row) => row.fileIndex !== undefined)?.id,
    )
  }

  const clearFileTreePatchState = () => {
    setHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
  }

  const scrollPatchNodeToTop = (node: BoxRenderable) => {
    frame(() => {
      if (!scroll) return
      const delta = node.y - scroll.viewport.y
      const contentY = scroll.scrollTop + delta
      scroll.scrollBy(delta + (contentY === 0 ? 0 : 1))
    })
  }

  const revealFileTreeFile = (fileIndex: number) => {
    const selection = fileTreeFileSelection(fileTree(), fileIndex)
    if (!selection) return
    setExpandedFileNodes((expanded) => {
      const next = new Set(expanded)
      selection.expandedNodes.forEach((node) => next.add(node))
      return next
    })
    setHighlighted(selection.highlightedNode)
  }

  const selectPatchFile = (fileIndex: number) => {
    revealFileTreeFile(fileIndex)
    setActivePatchFileIndex(fileIndex)
    setSelectedFileIndex(fileIndex)
  }

  const scrollToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
    const node = patchNodeByFileIndex.get(fileIndex)
    if (node) scrollPatchNodeToTop(node)
  }

  const currentPatchFileIndex = () => {
    if (!scroll) return undefined
    const current = scroll
    const viewportContentY = current.scrollTop + 1
    const entries = patchFileIndexes()
      .map((fileIndex) => ({ fileIndex, node: patchNodeByFileIndex.get(fileIndex) }))
      .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
      .map((entry) => ({ ...entry, contentY: current.scrollTop + entry.node.y - current.viewport.y }))
      .sort((left, right) => left.contentY - right.contentY)
    return entries.findLast((entry) => entry.contentY <= viewportContentY)?.fileIndex ?? entries[0]?.fileIndex
  }

  const firstPatchFileIndex = () => fileRows().find((row) => row.fileIndex !== undefined)?.fileIndex
  const visiblePatchFiles = createMemo(() => {
    if (!singlePatch()) {
      return patchFileIndexes().flatMap((fileIndex) => {
        const file = files()[fileIndex]
        return file ? [{ file, fileIndex }] : []
      })
    }
    const fileIndex = singlePatchFileIndex(
      selectedFileIndex(),
      activePatchFileIndex(),
      currentPatchFileIndex(),
      firstPatchFileIndex(),
    )
    const file = fileIndex === undefined ? undefined : files()[fileIndex]
    return file && fileIndex !== undefined ? [{ file, fileIndex }] : []
  })

  const measurePatchFiller = () => {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
    measureFrame = frame(() => {
      measureFrame = undefined
      if (!scroll) return
      const nodes = visiblePatchFiles()
        .map((entry) => patchNodeByFileIndex.get(entry.fileIndex))
        .filter((node): node is BoxRenderable => Boolean(node))
      if (!nodes.length) {
        setPatchFillerHeight(0)
        return
      }
      const current = scroll
      const contentHeight = Math.max(...nodes.map((node) => current.scrollTop + node.y - current.viewport.y + node.height))
      setPatchFillerHeight(Math.max(0, current.viewport.height - contentHeight))
    })
  }

  const scrollToPatchFileIndexAfterRender = (fileIndex: number) => {
    setPendingPatchScrollFileIndex(fileIndex)
    frame(() => {
      const node = patchNodeByFileIndex.get(fileIndex)
      if (node) scrollPatchNodeToTop(node)
      frame(() => {
        const next = patchNodeByFileIndex.get(fileIndex)
        if (next) scrollPatchNodeToTop(next)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  const scrollSinglePatchToTop = () => {
    frame(() => {
      scroll?.scrollTo(0)
      frame(() => scroll?.scrollTo(0))
    })
  }

  const registerPatchNode = (fileIndex: number, element: BoxRenderable) => {
    patchNodeByFileIndex.set(fileIndex, element)
    measurePatchFiller()
    if (pendingPatchScrollFileIndex() !== fileIndex) return
    frame(() => {
      scrollPatchNodeToTop(element)
      frame(() => {
        scrollPatchNodeToTop(element)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  createEffect(() => {
    visiblePatchFiles()
    dimensions()
    view()
    measurePatchFiller()
  })

  const toggleSelectedFileReviewed = () => {
    const currentSessionID = sessionID()
    const fileIndex =
      focus() === "files"
        ? fileRows().find((row) => row.id === highlightedFileNode())?.fileIndex
        : (selectedFileIndex() ?? activePatchFileIndex() ?? currentPatchFileIndex())
    const file = fileIndex === undefined ? undefined : files()[fileIndex]?.file
    if (!file) return
    const next = new Set(reviewedFileNames())
    if (next.has(file)) next.delete(file)
    else next.add(file)
    setReviewedFileNames(next)
    if (!currentSessionID) return
    const reviewedAt =
      files().length > 0 && files().every((item) => next.has(item.file))
        ? Math.max(Date.now(), sync.session.get(currentSessionID)?.time.updated ?? 0)
        : undefined
    const currentState = sync.data.session_ui_state[currentSessionID]
    sync.set("session_ui_state", currentSessionID, {
      sessionID: currentSessionID,
      seenAt: currentState?.seenAt,
      reviewedAt: Math.max(reviewedAt ?? 0, currentState?.reviewedAt ?? 0) || undefined,
      reviewedFiles: [...next],
      displayStatus:
        reviewedAt && currentState?.displayStatus === "needs_review" ? "idle" : (currentState?.displayStatus ?? "idle"),
      updated: currentState?.updated ?? false,
    })
    void updateClientSessionState(api.client, currentSessionID, {
      expectedReviewedFiles: currentState?.reviewedFiles ?? [],
      reviewedFiles: [...next],
      reviewedAt,
    }).catch(() => {})
  }

  const toggleSinglePatch = () => {
    if (!singlePatch()) {
      const fileIndex = currentPatchFileIndex() ?? activePatchFileIndex() ?? firstPatchFileIndex()
      if (fileIndex !== undefined) selectPatchFile(fileIndex)
      setSinglePatch(true)
      api.kv.set(DIFF_KV_SINGLE_PATCH, true)
      scrollSinglePatchToTop()
      return
    }
    const fileIndex =
      visiblePatchFiles()[0]?.fileIndex ??
      singlePatchFileIndex(selectedFileIndex(), activePatchFileIndex(), currentPatchFileIndex(), firstPatchFileIndex())
    if (fileIndex !== undefined) selectPatchFile(fileIndex)
    setSinglePatch(false)
    api.kv.set(DIFF_KV_SINGLE_PATCH, false)
    if (fileIndex !== undefined) scrollToPatchFileIndexAfterRender(fileIndex)
  }

  return {
    api,
    dimensions,
    params,
    mode,
    diff,
    files,
    focus,
    showFileTree,
    patchLeftBorder,
    splitAvailable,
    view,
    expandedFileNodes,
    highlightedFileNode,
    selectedFileIndex,
    reviewedFileNames,
    patchFillerHeight,
    visiblePatchFiles,
    patchScrollAcceleration: createMemo(() => getScrollAcceleration(api.tuiConfig)),
    setScroll(element: ScrollBoxRenderable) {
      scroll = element
    },
    registerPatchNode,
    clickFileTreeRow(row: FileTreeRow) {
      setFocus("files")
      setHighlighted(row.id)
      if (row.fileIndex !== undefined) {
        scrollToFileIndex(row.fileIndex)
        return
      }
      setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, row.id))
    },
    move(offset: number) {
      if (focus() === "files") {
        setHighlighted(moveFileTreeSelection(fileRows(), highlightedFileNode(), offset))
        return
      }
      clearFileTreePatchState()
      scroll?.scrollBy(offset)
    },
    page(offset: number) {
      if (focus() === "files") {
        setHighlighted(moveFileTreeSelection(fileRows(), highlightedFileNode(), offset * 8))
        return
      }
      clearFileTreePatchState()
      if (scroll) scroll.scrollBy(offset * scroll.height)
    },
    toggleSelectedFileTreeRow() {
      const highlighted = fileRows().find((row) => row.id === highlightedFileNode())
      if (highlighted?.fileIndex !== undefined) {
        scrollToFileIndex(highlighted.fileIndex)
        return
      }
      setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, highlightedFileNode()))
    },
    expandSelected() {
      const highlighted = highlightedFileNode()
      if (highlighted !== undefined && expandedFileNodes().has(highlighted)) {
        setHighlighted(moveFileTreeSelectionToFirstChild(fileRows(), highlighted))
        return
      }
      setExpandedFileNodes((expanded) => setFileTreeDirectoryExpanded(fileTree(), expanded, highlighted, true))
    },
    expandAll() {
      setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
    },
    collapseSelected() {
      const highlighted = highlightedFileNode()
      const node = highlighted === undefined ? undefined : fileTree().nodes[highlighted]
      if (node?.kind !== "directory" || !expandedFileNodes().has(node.id)) {
        setHighlighted(moveFileTreeSelectionToParent(fileRows(), highlighted))
        return
      }
      setExpandedFileNodes((expanded) => setFileTreeDirectoryExpanded(fileTree(), expanded, highlighted, false))
    },
    jumpRelativePatchFile(offset: number) {
      const next = movePatchFileIndex(patchFileIndexes(), selectedFileIndex() ?? activePatchFileIndex(), offset)
      if (!singlePatch()) {
        scrollToFileIndex(next)
        return
      }
      if (next === undefined) return
      selectPatchFile(next)
      scrollSinglePatchToTop()
    },
    toggleSelectedFileReviewed,
    switchFocus() {
      if (!showFileTree()) return
      setFocus((current) => {
        if (current === "files") return "patches"
        ensureHighlightedFileNode()
        return "files"
      })
    },
    toggleFileTree() {
      const next = !fileTreeEnabled()
      if (!next) setFocus("patches")
      setFileTreeEnabled(next)
      api.kv.set(DIFF_KV_SHOW_FILE_TREE, next)
    },
    toggleSinglePatch,
    toggleView() {
      if (!splitAvailable()) return
      const next = view() === "split" ? "unified" : "split"
      setViewOverride(next)
      api.kv.set(DIFF_KV_VIEW, next)
    },
  }
}

export type DiffViewerController = ReturnType<typeof createDiffViewerController>
