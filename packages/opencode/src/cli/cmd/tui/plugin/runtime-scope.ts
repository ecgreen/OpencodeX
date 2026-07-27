import type { CleanupResult, DisposeItem, PluginLoad, PluginScope } from "./runtime-types"
import { fail } from "./runtime-diagnostics"

function runCleanup(fn: () => unknown, ms: number): Promise<CleanupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ type: "timeout" })
    }, ms)

    Promise.resolve()
      .then(fn)
      .then(
        () => {
          resolve({ type: "ok" })
        },
        (error) => {
          resolve({ type: "error", error })
        },
      )
      .finally(() => {
        clearTimeout(timer)
      })
  })
}

export function createPluginScope(load: PluginLoad, id: string, disposeTimeoutMs: number): PluginScope {
  const ctrl = new AbortController()
  let list: DisposeItem[] = []
  let done = false

  const onDispose = (fn: DisposeItem["fn"]) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    let drop = false
    return () => {
      if (drop) return
      drop = true
      list = list.filter((item) => item.key !== key)
    }
  }

  const track = (fn: (() => void) | undefined) => {
    if (!fn) return () => {}
    let drop = false
    let off = () => {}
    const wrapped = () => {
      if (drop) return
      drop = true
      off()
      fn()
    }
    off = onDispose(wrapped)
    return wrapped
  }

  const dispose = async () => {
    if (done) return
    done = true
    ctrl.abort()
    const queue = [...list].reverse()
    list = []
    const until = Date.now() + disposeTimeoutMs
    for (const item of queue) {
      const left = until - Date.now()
      if (left <= 0) {
        fail("timed out cleaning up tui plugin", { path: load.spec, id, timeout: disposeTimeoutMs })
        break
      }

      const out = await runCleanup(item.fn, left)
      if (out.type === "ok") continue
      if (out.type === "timeout") {
        fail("timed out cleaning up tui plugin", { path: load.spec, id, timeout: disposeTimeoutMs })
        break
      }
      fail("failed to clean up tui plugin", { path: load.spec, id, error: out.error })
    }
  }

  return {
    lifecycle: {
      signal: ctrl.signal,
      onDispose,
    },
    track,
    dispose,
  }
}
