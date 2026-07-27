import { compactPath } from "../lib/format"
import { workbenchNormalizeBrowserURL } from "../lib/workbench"

export function isBrowserInput(value: string) {
  const input = value.trim()
  if (/^file:/i.test(input)) return false
  if (/^(https?|about):/i.test(input)) return true
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^(?:127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^\[::1\](?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (isFileInput(input)) return false
  if (/^[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(input)) return true
  return /^[^\s]+:\d+(?:\/.*)?$/i.test(input)
}

export function inputLabel(value: string, directory = "") {
  if (!value.trim()) return "New tab"
  if (!isBrowserInput(value)) return compactPath(filePathFromInput(value, directory))
  try {
    const url = new URL(workbenchNormalizeBrowserURL(value))
    return url.hostname || url.toString()
  } catch {
    return value
  }
}

export function webLocationValue(value: string) {
  return value.replace(/^https:\/\//i, "")
}

export function webInputURL(value: string) {
  const input = value.trim()
  if (!input) return ""
  if (isBrowserInput(input)) return workbenchNormalizeBrowserURL(input)
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}

export function filePathFromInput(value: string, directory = "") {
  const decoded = normalizeFilePath(value)
  const root = normalizeRoot(directory)
  if (root && isWithinRoot(decoded, root)) return decoded.slice(root.length + 1)
  return decoded.replace(/^\.\/+/, "")
}

export function normalizeFilePath(value: string) {
  return safeDecodeURIComponent(value.replace(/^file:\/+/i, "")).replaceAll("\\", "/").replace(/\/+$/, "")
}

export function normalizeRoot(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "")
}

export function sidePanelPathKey(value: string) {
  return normalizeFilePath(value).replace(/^\.\/+/, "").toLowerCase()
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isFileInput(value: string) {
  if (/^\.{1,2}(?:\/|\\)/.test(value)) return true
  if (/^(?:[a-z]:)?[\\/]/i.test(value)) return true
  if (/^[a-z]:[\\/]/i.test(value)) return true
  if (value.includes("\\") || value.includes("/")) {
    const first = value.split(/[\\/]/)[0] ?? ""
    return !/^[^\s.]+\.[^\s.]+$/.test(first)
  }
  if (/\.(?:astro|bash|c|cc|cjs|cpp|cs|css|env|fish|go|gql|graphql|h|hpp|html?|java|json|jsonc|jsx|kt|less|lock|log|md|mdx|mjs|php|ps1|py|rb|rs|sass|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|ya?ml|zsh)$/i.test(value)) return true
  return /^(?:bunfig|dockerfile|eslint|makefile|package|pnpm-lock|prettier|tsconfig|vite|vitest|yarn)(?:\.[\w.-]+)?$/i.test(value)
}

function isWithinRoot(path: string, root: string) {
  return path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
