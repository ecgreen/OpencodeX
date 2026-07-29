import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { clientGlobalEventData, clientGlobalEventKind } from "@opencode-ai/sdk/v2/client-sync"

/** Mirrors the TUI's `skipped_version` kv entry, which serves the same purpose. */
export const SKIPPED_VERSION_KEY = "opencodex.gui.skippedVersion"

export type UpdateNotice = {
  version: string
  skipped: boolean
}

export function updateAvailableVersion(event: GlobalEvent) {
  if (clientGlobalEventKind(event.payload) !== "installation.update-available") return undefined
  const version = clientGlobalEventData(event.payload)?.version
  return typeof version === "string" && version.length > 0 ? version : undefined
}

/**
 * Release-version ordering, matching the TUI's `semver.gt(version, skipped)`
 * guard: a skip suppresses that release and anything older, never a newer one.
 * Prerelease identifiers are not ranked - the numeric core decides - because
 * the update feed this reads publishes release versions.
 */
export function isNewerVersion(candidate: string, baseline: string) {
  const left = versionParts(candidate)
  const right = versionParts(baseline)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

export function shouldShowUpdateNotice(notice: UpdateNotice | undefined, skippedVersion: string | undefined) {
  if (!notice || notice.skipped) return false
  if (!skippedVersion) return true
  return isNewerVersion(notice.version, skippedVersion)
}

export function readSkippedVersion() {
  if (typeof localStorage === "undefined") return undefined
  return localStorage.getItem(SKIPPED_VERSION_KEY) ?? undefined
}

export function writeSkippedVersion(version: string) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(SKIPPED_VERSION_KEY, version)
  } catch {
    // A full or blocked store only costs the reader a repeated notice.
  }
}

function versionParts(value: string) {
  return (value.split("+")[0] ?? "")
    .split("-")[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
}
