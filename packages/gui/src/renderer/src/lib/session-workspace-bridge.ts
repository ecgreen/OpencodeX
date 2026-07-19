export type SessionWorkspaceTarget =
  | { tab: "context" }
  | { tab: "git"; value?: string }
  | { tab: "open"; value?: string; title?: string }

export type SessionWorkspaceRequest =
  | { operation: "workspace.open"; input: { path: string } }
  | { operation: "browser.navigate"; input: { url: string } }
  | { operation: "browser.state"; input: Record<string, never> }
  | { operation: "browser.screenshot"; input: { expectedURL: string } }
  | { operation: "browser.snapshot"; input: { expectedURL: string } }

export type SessionWorkspaceResult =
  | { operation: "workspace.open"; output: { path: string } }
  | { operation: "browser.navigate"; output: { url: string } }
  | { operation: "browser.state"; output: { url: string } }
  | { operation: "browser.screenshot"; output: { url: string; dataURL: string } }
  | { operation: "browser.snapshot"; output: { url: string; text: string } }

const DEFAULT_MOUNT_TIMEOUT_MS = 15_000

export function createSessionWorkspaceBridge() {
  const requestHandlers = new Map<string, (request: SessionWorkspaceRequest) => Promise<SessionWorkspaceResult>>()
  const targetHandlers = new Map<string, (target: SessionWorkspaceTarget) => void>()
  const pendingRequests = new Map<string, Array<{
    request: SessionWorkspaceRequest
    resolve: (result: SessionWorkspaceResult) => void
    reject: (cause: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>>()
  const pendingTargets = new Map<string, Array<{
    target: SessionWorkspaceTarget
    timer: ReturnType<typeof setTimeout>
  }>>()
  const requestTails = new Map<string, Promise<void>>()

  function request(sessionID: string, value: SessionWorkspaceRequest, timeout = DEFAULT_MOUNT_TIMEOUT_MS) {
    const handler = requestHandlers.get(sessionID)
    if (handler) return invoke(sessionID, handler, value)
    return new Promise<SessionWorkspaceResult>((resolve, reject) => {
      const entry = {
        request: value,
        resolve,
        reject,
        timer: setTimeout(() => {
          const pending = pendingRequests.get(sessionID)?.filter((item) => item !== entry) ?? []
          if (pending.length > 0) pendingRequests.set(sessionID, pending)
          else pendingRequests.delete(sessionID)
          reject(new Error(`Session workspace ${sessionID} did not mount in time.`))
        }, timeout),
      }
      pendingRequests.set(sessionID, [...(pendingRequests.get(sessionID) ?? []), entry])
    })
  }

  function registerRequestHandler(
    sessionID: string,
    handler: (request: SessionWorkspaceRequest) => Promise<SessionWorkspaceResult>,
  ) {
    requestHandlers.set(sessionID, handler)
    const pending = pendingRequests.get(sessionID) ?? []
    pendingRequests.delete(sessionID)
    pending.forEach((entry) => {
      clearTimeout(entry.timer)
      void invoke(sessionID, handler, entry.request).then(entry.resolve, entry.reject)
    })
    return () => {
      if (requestHandlers.get(sessionID) === handler) requestHandlers.delete(sessionID)
    }
  }

  function openTarget(sessionID: string, target: SessionWorkspaceTarget, timeout = DEFAULT_MOUNT_TIMEOUT_MS) {
    const handler = targetHandlers.get(sessionID)
    if (handler) {
      handler(target)
      return
    }
    const entry = {
      target,
      timer: setTimeout(() => {
        const pending = pendingTargets.get(sessionID)?.filter((item) => item !== entry) ?? []
        if (pending.length > 0) pendingTargets.set(sessionID, pending)
        else pendingTargets.delete(sessionID)
      }, timeout),
    }
    pendingTargets.set(sessionID, [...(pendingTargets.get(sessionID) ?? []), entry])
  }

  function registerTargetHandler(sessionID: string, handler: (target: SessionWorkspaceTarget) => void) {
    targetHandlers.set(sessionID, handler)
    const pending = pendingTargets.get(sessionID) ?? []
    pendingTargets.delete(sessionID)
    pending.forEach((entry) => {
      clearTimeout(entry.timer)
      handler(entry.target)
    })
    return () => {
      if (targetHandlers.get(sessionID) === handler) targetHandlers.delete(sessionID)
    }
  }

  function invoke(
    sessionID: string,
    handler: (request: SessionWorkspaceRequest) => Promise<SessionWorkspaceResult>,
    request: SessionWorkspaceRequest,
  ) {
    const result = withTimeout(
      (requestTails.get(sessionID) ?? Promise.resolve()).then(() => handler(request)),
      DEFAULT_MOUNT_TIMEOUT_MS,
      `Session workspace ${sessionID} did not complete the operation in time.`,
    )
    const settled = result.then(() => undefined, () => undefined)
    requestTails.set(sessionID, settled)
    void settled.then(() => {
      if (requestTails.get(sessionID) === settled) requestTails.delete(sessionID)
    })
    return result
  }

  return { request, registerRequestHandler, openTarget, registerTargetHandler }
}

function withTimeout<T>(promise: Promise<T>, timeout: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (cause) => { clearTimeout(timer); reject(cause) },
    )
  })
}

const sessionWorkspaceBridge = createSessionWorkspaceBridge()

export const requestSessionWorkspace = sessionWorkspaceBridge.request
export const registerSessionWorkspaceRequestHandler = sessionWorkspaceBridge.registerRequestHandler
export const openSessionWorkspace = sessionWorkspaceBridge.openTarget
export const registerSessionWorkspaceTargetHandler = sessionWorkspaceBridge.registerTargetHandler
