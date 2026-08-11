import { createSignal, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { workbenchGitBranches } from "../lib/session-api"
import { isWorkbenchAbort } from "./session-side-git-model"

// Repository metadata (branch, upstream, ahead/behind, remote URL) only
// changes when the workspace's Git revision changes, but callers poll and
// re-run this on every manifest load/refresh (30s poll + file-watcher
// ticks). Re-fetching unconditionally costs several extra git subprocesses
// per tick for no benefit, so callers pass the manifest's current revision
// and this only re-fetches when it differs from the last *successfully*
// loaded revision (a failed load must not record the revision, so the next
// refresh retries it).
export function shouldLoadRepository(lastRevision: string | undefined, currentRevision: string): boolean {
  return lastRevision === undefined || lastRevision !== currentRevision
}

export function createWorkbenchRepositoryController(input: {
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
}) {
  const [branch, setBranch] = createSignal("")
  const [repository, setRepository] = createSignal<{
    defaultBranch?: string
    upstream?: string
    ahead?: number
    behind?: number
    remoteUrl?: string
    githubUrl?: string
  }>({})
  let request: AbortController | undefined
  let lastRevision: string | undefined

  async function load(revision: string) {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    if (!shouldLoadRepository(lastRevision, revision)) return
    request?.abort()
    const controller = new AbortController()
    request = controller
    try {
      const result = await workbenchGitBranches(gui, directory, controller.signal)
      if (request !== controller || controller.signal.aborted || gui !== input.gui() || directory !== input.directory() || !result.ok) return
      lastRevision = revision
      setBranch(result.current ?? "")
      setRepository({
        defaultBranch: result.defaultBranch,
        upstream: result.upstream,
        ahead: result.ahead,
        behind: result.behind,
        remoteUrl: result.remoteUrl,
        githubUrl: result.githubUrl,
      })
    } catch (cause) {
      if (isWorkbenchAbort(cause)) return
      // Real failure of the branches endpoint (not an abort): this controller
      // has no dedicated error/retry signal today, and wiring one up would
      // mean threading it through session-side-git-controller and the view's
      // notice row. Deliberately degrade instead of crashing or silently
      // resetting: leave the last-known branch/repository metadata in place
      // (stale-but-present beats blank) rather than clearing it, and swallow
      // the error. `lastRevision` is intentionally left unset so the next
      // refresh retries the fetch. If this proves confusing in practice,
      // promote it to a real signal following the sibling `refreshError`
      // pattern.
      return
    } finally {
      if (request === controller) request = undefined
    }
  }

  function reset() {
    request?.abort()
    request = undefined
    lastRevision = undefined
    setBranch("")
    setRepository({})
  }

  return { branch, repository, load, reset, abort: () => request?.abort() }
}
