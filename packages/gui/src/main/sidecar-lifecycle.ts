import type { ChildProcess } from "node:child_process"

type SidecarLifecycleOptions<Connection> = {
  start: (signal: AbortSignal) => Promise<Connection>
  health?: (connection: Connection) => Promise<boolean>
  install: (connection: Connection) => void
  reset: () => void
  stop: () => Promise<void> | void
  awaitStopped?: () => Promise<void>
}

export function createSidecarLifecycle<Connection>(options: SidecarLifecycleOptions<Connection>) {
  let generation = 0
  let cached: Connection | undefined
  let current: { controller: AbortController; promise: Promise<Connection> } | undefined
  let stopping: Promise<void> | undefined
  let restarting: Promise<Connection> | undefined

  const ensureNow = (): Promise<Connection> => {
    if (stopping) return stopping.then(ensure)
    if (current) return current.promise

    const controller = new AbortController()
    const startedGeneration = generation
    const started = (async () => {
      if (cached !== undefined && (!options.health || (await options.health(cached)))) return cached
      if (cached !== undefined) {
        cached = undefined
        options.reset()
        await options.stop()
      }
      return await options.start(controller.signal)
    })()
    const promise = started
      .then((connection) => {
        if (generation !== startedGeneration || controller.signal.aborted) throw stoppedError()
        if (cached !== connection) options.install(connection)
        cached = connection
        return connection
      })
      .finally(() => {
        if (current?.controller === controller) current = undefined
      })
    current = { controller, promise }
    return promise
  }

  const ensure = (): Promise<Connection> => restarting ?? ensureNow()

  const stopNow = () => {
    if (stopping) return stopping
    const result = (async () => {
      generation += 1
      const pending = current?.promise
      current?.controller.abort()
      current = undefined
      cached = undefined
      options.reset()
      await Promise.all([options.stop(), pending?.catch(() => undefined)])
    })()
    stopping = result.finally(() => {
      stopping = undefined
    })
    return stopping
  }

  const stop = () => restarting?.then(stopNow, stopNow) ?? stopNow()

  const restart = () => {
    if (restarting) return restarting
    const result = (async () => {
      await stopNow()
      try {
        await options.awaitStopped?.()
      } catch (error) {
        await ensureNow()
        throw error
      }
      return ensureNow()
    })()
    restarting = result.finally(() => {
      restarting = undefined
    })
    return restarting
  }

  return { ensure, restart, stop }
}

function stoppedError() {
  const error = new Error("Sidecar startup was stopped")
  error.name = "AbortError"
  return error
}

export async function stopDetachedChild(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) child.kill(process.platform === "win32" ? undefined : "SIGTERM")
  await waitForExit(child, 3_000)
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await waitForExit(child, 2_000)
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`Detached sidecar process ${child.pid ?? "unknown"} did not exit`)
  }
}

function waitForExit(child: ChildProcess, timeout: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      child.off("exit", done)
      resolve()
    }
    const timer = setTimeout(done, timeout)
    child.once("exit", done)
  })
}
