const refreshOpencodeXHandlers = new Set<() => void>()

export function refreshOpencodeXSidebar() {
  refreshOpencodeXHandlers.forEach((handler) => handler())
}

export function onOpencodeXRefresh(handler: () => void) {
  refreshOpencodeXHandlers.add(handler)
  return () => {
    refreshOpencodeXHandlers.delete(handler)
  }
}
