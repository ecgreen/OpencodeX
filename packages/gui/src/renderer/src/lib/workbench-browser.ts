import type { WorkbenchArtifact, WorkbenchBrowserTab, WorkbenchBrowserTabState } from "./workbench"

export function addWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], tab: WorkbenchBrowserTab) {
  return tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab]
}

export function activeWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], activeID: string) {
  return tabs.find((tab) => tab.id === activeID) ?? tabs[0]
}

export function updateWorkbenchBrowserTabURL(tabs: WorkbenchBrowserTab[], id: string, url: string) {
  return tabs.map((tab) => tab.id === id ? { ...tab, url } : tab)
}

export function updateWorkbenchBrowserTabState(tabs: WorkbenchBrowserTab[], state: WorkbenchBrowserTabState) {
  return tabs.map((tab) => tab.id === state.id ? {
    ...tab,
    url: state.url || tab.url,
    title: state.title || tab.title,
    state,
  } : tab)
}

export function closeWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], activeID: string, id: string) {
  const index = tabs.findIndex((tab) => tab.id === id)
  const nextTabs = tabs.filter((tab) => tab.id !== id)
  return {
    tabs: nextTabs,
    activeID: activeID === id ? nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? "" : activeID,
  }
}

export function addWorkbenchArtifact(
  artifacts: readonly WorkbenchArtifact[],
  artifact: Omit<WorkbenchArtifact, "id" | "created"> & { id?: string; created?: number },
  limit = 50,
) {
  const created = artifact.created ?? Date.now()
  const next = {
    ...artifact,
    id: artifact.id ?? `artifact-${created}`,
    created,
  }
  return [next, ...artifacts.filter((item) => item.id !== next.id)].slice(0, limit)
}

export function removeWorkbenchArtifact(artifacts: readonly WorkbenchArtifact[], id: string) {
  return artifacts.filter((item) => item.id !== id)
}

export function workbenchArtifactOpenURL(artifact: Pick<WorkbenchArtifact, "kind" | "url">) {
  if (!artifact.url) return
  if (artifact.kind === "link") return artifact.url
  return artifact.url.startsWith("http") ? artifact.url : undefined
}

export function workbenchBrowserPageArtifact(input: { url?: string; title?: string }) {
  const inputURL = input.url?.trim()
  if (!inputURL) return
  const url = workbenchNormalizeBrowserURL(inputURL)
  const title = input.title?.trim() || workbenchBrowserURLLabel(url)
  return {
    kind: "link" as const,
    title,
    url,
    text: `Browser page: ${title}\n${url}`,
  }
}

export function workbenchBrowserTabLabel(tab: WorkbenchBrowserTab | undefined) {
  if (!tab) return "New tab"
  const title = tab.state?.title || tab.title
  if (title) return title
  try {
    const url = new URL(tab.state?.url || tab.url)
    return url.hostname || url.toString()
  } catch {
    return tab.url || "New tab"
  }
}

export function workbenchNormalizeBrowserURL(value: string) {
  const input = value.trim()
  if (!input) return "about:blank"
  if (/^(https?|file|about):/i.test(input)) return input
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^(?:127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^\[::1\](?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(input)) return `https://${input}`
  if (/^[^\s]+:\d+(?:\/.*)?$/i.test(input)) return `http://${input}`
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}

function workbenchBrowserURLLabel(value: string) {
  try {
    const url = new URL(workbenchNormalizeBrowserURL(value))
    return url.hostname || url.toString()
  } catch {
    return "Browser page"
  }
}
