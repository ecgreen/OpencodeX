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
