import type { GuiConnection } from "../preload/index"

declare global {
  interface Window {
    opencodex?: {
      connection(): Promise<GuiConnection>
    }
  }
}

export {}
