import { useKV } from "@tui/context/kv"

const KV_KEY = "ox_sidebar_visible"
const focusHandlers = new Set<() => void>()

export const OPENCODEX_SIDEBAR_WIDTH = 36

export function focusOpencodeXSidebar() {
  focusHandlers.forEach((handler) => handler())
}

export function onOpencodeXSidebarFocus(handler: () => void) {
  focusHandlers.add(handler)
  return () => {
    focusHandlers.delete(handler)
  }
}

export function useOxSidebar() {
  return useKV().signal<boolean>(KV_KEY, false)
}
