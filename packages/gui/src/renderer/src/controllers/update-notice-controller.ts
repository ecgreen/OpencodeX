import { createSignal, onCleanup } from "solid-js"
import type { createAuthoritativeStateController } from "./authoritative-state-controller"
import { authHeaders } from "../lib/session-api"
import {
  readSkippedVersion,
  shouldShowUpdateNotice,
  updateAvailableVersion,
  writeSkippedVersion,
  type UpdateNotice,
} from "../lib/update-notice"

/**
 * Surfaces `installation.update-available` the way the TUI does.
 *
 * The TUI turns this event into a modal with Update and Skip; the GUI shipped
 * no handler at all, so a GUI-only user never learned a backend update existed.
 * Update calls the same `/global/upgrade` endpoint the TUI uses, and Skip
 * persists the version locally, mirroring the TUI's `skipped_version` kv.
 */
export function createUpdateNoticeController(input: {
  authoritative: ReturnType<typeof createAuthoritativeStateController>
  alert: (message: string) => void
}) {
  const [notice, setNotice] = createSignal<UpdateNotice>()
  const [upgrading, setUpgrading] = createSignal(false)
  const [skippedVersion, setSkippedVersion] = createSignal(readSkippedVersion())

  onCleanup(
    input.authoritative.subscribeGlobalEvents((event) => {
      const version = updateAvailableVersion(event)
      if (!version) return
      setNotice((current) => (current?.version === version ? current : { version, skipped: false }))
    }),
  )

  function visible() {
    return shouldShowUpdateNotice(notice(), skippedVersion())
  }

  function skip() {
    const current = notice()
    if (!current) return
    writeSkippedVersion(current.version)
    setSkippedVersion(current.version)
    setNotice({ ...current, skipped: true })
  }

  async function upgrade() {
    const current = notice()
    const gui = input.authoritative.client()
    if (!current || !gui || upgrading()) return
    setUpgrading(true)
    try {
      const result = await gui.client.global.upgrade(
        { target: current.version },
        { headers: authHeaders(gui), throwOnError: true },
      )
      if (!result.data?.success) throw new Error(result.data?.error ?? "Update failed")
      setNotice({ ...current, skipped: true })
      input.alert(`Updated to v${result.data.version}. Restart OpencodeX to finish.`)
    } catch (cause) {
      input.alert(`Update failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setUpgrading(false)
    }
  }

  return { notice, visible, upgrading, upgrade, skip }
}
