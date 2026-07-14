import type { BrowserState, ContextPath, GuiConnection, TerminalDataEvent, TerminalExitEvent, TerminalResult } from "../preload/index"

declare global {
  interface Window {
    opencodex?: {
      connection(): Promise<GuiConnection>
      folder(defaultPath?: string): Promise<string | undefined>
      folders?(defaultPath?: string): Promise<string[] | undefined>
      file?(defaultPath?: string): Promise<string | undefined>
      contextPaths?(defaultPath?: string): Promise<ContextPath[] | undefined>
      pathForFile?(file: File): string
      editor(input: { value: string; cwd?: string }): Promise<string | undefined>
      terminal?: {
        create(input: { id: string; cwd?: string; cols?: number; rows?: number }): Promise<TerminalResult>
        write(input: { id: string; data: string }): void
        resize(input: { id: string; cols: number; rows: number }): void
        destroy(id: string): Promise<boolean>
        onData(listener: (event: TerminalDataEvent) => void): () => void
        onExit(listener: (event: TerminalExitEvent) => void): () => void
      }
      window(action: "minimize" | "maximize" | "close"): Promise<void>
      edit?(action: "cut" | "copy" | "paste"): Promise<void>
      browser?: {
        create(input: { id: string; url?: string }): Promise<BrowserState | undefined>
        bounds(input: { id: string; x: number; y: number; width: number; height: number }): Promise<BrowserState | undefined>
        hide(id: string): Promise<BrowserState | undefined>
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
