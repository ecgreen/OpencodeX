import type { GuiConnection } from "../preload/index"

declare global {
  interface Window {
    opencodex?: {
      connection(): Promise<GuiConnection>
      folder(defaultPath?: string): Promise<string | undefined>
      window(action: "minimize" | "maximize" | "close"): Promise<void>
    }
  }
}

export {}
