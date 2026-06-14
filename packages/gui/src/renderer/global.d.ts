import type { BrowserState, GuiConnection } from "../preload/index"

declare global {
  interface Window {
    opencodex?: {
      connection(): Promise<GuiConnection>
      folder(defaultPath?: string): Promise<string | undefined>
      editor(input: { value: string; cwd?: string }): Promise<string | undefined>
      window(action: "minimize" | "maximize" | "close"): Promise<void>
      browser?: {
        create(input: { id: string; url?: string }): Promise<BrowserState | undefined>
        bounds(input: { id: string; x: number; y: number; width: number; height: number }): Promise<BrowserState | undefined>
        navigate(input: { id: string; url: string }): Promise<BrowserState | undefined>
        action(input: { id: string; action: "back" | "forward" | "reload" | "stop" }): Promise<BrowserState | undefined>
        screenshot(id: string): Promise<string | undefined>
        devtools(id: string): Promise<BrowserState | undefined>
        destroy(id: string): Promise<boolean | undefined>
      }
    }
  }
}

export {}
