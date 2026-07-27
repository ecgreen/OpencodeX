import { Flag } from "@opencode-ai/core/flag/flag"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createCliRenderer, type CliRenderer, type CliRendererConfig } from "@opentui/core"
import { render } from "@opentui/solid"
import { ErrorBoundary } from "solid-js"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { DialogProviderList } from "@tui/component/dialog-provider"
import { ErrorComponent } from "@tui/component/error-component"
import { ArgsProvider, type Args } from "@tui/context/args"
import { EditorContextProvider } from "@tui/context/editor"
import { createExit, ExitProvider, type Exit } from "@tui/context/exit"
import { KVProvider } from "@tui/context/kv"
import { LocalProvider } from "@tui/context/local"
import { ProjectProvider } from "@tui/context/project"
import { PromptRefProvider } from "@tui/context/prompt"
import { RouteProvider } from "@tui/context/route"
import { SDKProvider, type EventSource } from "@tui/context/sdk"
import { SyncProvider } from "@tui/context/sync"
import { SyncProviderV2 } from "@tui/context/sync-v2"
import { ThemeProvider } from "@tui/context/theme"
import { TuiConfigProvider } from "@tui/context/tui-config"
import { DialogProvider } from "@tui/ui/dialog"
import { ToastProvider } from "@tui/ui/toast"
import { Clipboard } from "@tui/util/clipboard"
import { TuiAudio } from "@tui/util/audio"
import { TuiConfig } from "./config/tui"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptDraftsProvider } from "./component/prompt/drafts"
import { PromptHistoryProvider } from "./component/prompt/history"
import { PromptStashProvider } from "./component/prompt/stash"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "./keymap"
import { TuiApp } from "./app-view"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"

export function tuiRendererConfig(config: TuiConfig.Resolved): CliRendererConfig {
  return {
    externalOutputMode: "passthrough",
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    useMouse: !Flag.OPENCODE_DISABLE_MOUSE && (config.mouse ?? true),
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
      onCopySelection: (text) => {
        Clipboard.copy(text).catch((error) => {
          console.error(`Failed to copy console selection to clipboard: ${error}`)
        })
      },
    },
  }
}

export function createTuiRenderer(config: TuiConfig.Resolved) {
  return createCliRenderer(tuiRendererConfig(config))
}

export type TuiHandle = {
  ready: Promise<void>
  done: Promise<void>
  exit: Exit
}

type TuiInput = {
  url: string
  args: Args
  config: TuiConfig.Resolved
  renderer: CliRenderer
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

export function tui(input: TuiInput): TuiHandle {
  const unguard = win32InstallCtrlCGuard()
  win32DisableProcessedInput()
  const keymap = createDefaultOpenTuiKeymap(input.renderer)
  const unregisterKeymap = registerOpencodeKeymap(keymap, input.renderer, input.config)
  const lifecycle = createTuiLifecycle({
    renderer: input.renderer,
    unguard,
    cleanup: async () => {
      unregisterKeymap()
      await TuiPluginRuntime.dispose()
      TuiAudio.dispose()
    },
  })
  const ready = mountTui({ ...input, keymap, exit: lifecycle.exit }).catch((error) => lifecycle.fail(error))
  return { ready, done: waitUntilDone(ready, lifecycle.exited), exit: lifecycle.exit }
}

async function mountTui(input: TuiInput & { keymap: ReturnType<typeof createDefaultOpenTuiKeymap>; exit: Exit }) {
  void input.renderer.getPalette({ size: 16 }).catch(() => undefined)
  const mode = (await input.renderer.waitForThemeMode(1000)) ?? "dark"
  if (input.renderer.isDestroyed) return

  await render(() => (
    <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} exit={input.exit} mode={mode} />}>
      <OpencodeKeymapProvider keymap={input.keymap}>
        <ArgsProvider {...input.args}>
          <ExitProvider exit={input.exit}>
            <KVProvider>
              <ToastProvider>
                <RouteProvider initialRoute={initialRoute(input.args)}>
                  <TuiConfigProvider config={input.config}>
                    <SDKProvider url={input.url} directory={input.directory} fetch={input.fetch} headers={input.headers} events={input.events}>
                      <ProjectProvider>
                        <SyncProvider>
                          <SyncProviderV2>
                            <ThemeProvider mode={mode}>
                              <LocalProvider>
                                <PromptStashProvider>
                                  <PromptDraftsProvider>
                                    <DialogProvider>
                                      <FrecencyProvider>
                                        <PromptHistoryProvider>
                                          <PromptRefProvider>
                                            <EditorContextProvider>
                                              <TuiApp onSnapshot={input.onSnapshot} />
                                            </EditorContextProvider>
                                          </PromptRefProvider>
                                        </PromptHistoryProvider>
                                      </FrecencyProvider>
                                    </DialogProvider>
                                  </PromptDraftsProvider>
                                </PromptStashProvider>
                              </LocalProvider>
                            </ThemeProvider>
                          </SyncProviderV2>
                        </SyncProvider>
                      </ProjectProvider>
                    </SDKProvider>
                  </TuiConfigProvider>
                </RouteProvider>
              </ToastProvider>
            </KVProvider>
          </ExitProvider>
        </ArgsProvider>
      </OpencodeKeymapProvider>
    </ErrorBoundary>
  ), input.renderer)
}

function initialRoute(args: Args) {
  if (args.continue) return { type: "session" as const, sessionID: "dummy" }
  if (args.prompt) return
  return { type: "opencodex-dashboard" as const }
}

function createTuiLifecycle(input: { renderer: CliRenderer; unguard?: () => void; cleanup: () => Promise<void> }) {
  let resolveExited!: () => void
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve
  })
  let exitCompleted = false
  let exiting = false
  let cleanupTask: Promise<void> | undefined
  const completeExit = () => {
    if (exitCompleted) return
    exitCompleted = true
    resolveExited()
  }
  const onSighup = () => void exit()
  const cleanup = () => {
    cleanupTask ??= input.cleanup().finally(() => {
      process.off("SIGHUP", onSighup)
      input.unguard?.()
    })
    return cleanupTask
  }
  const exit = createExit(async (reason, message) => {
    exiting = true
    if (!input.renderer.isDestroyed) {
      input.renderer.setTerminalTitle("")
      input.renderer.destroy()
    }
    await cleanup()
    win32FlushInputBuffer()
    if (reason) {
      const formatted = FormatError(reason) ?? FormatUnknownError(reason)
      if (formatted) process.stderr.write(formatted + "\n")
    }
    const text = message()
    if (text) process.stdout.write(text + "\n")
    completeExit()
  })

  input.renderer.once("destroy", () => {
    if (exiting) return
    void cleanup().finally(() => {
      win32FlushInputBuffer()
      completeExit()
    })
  })
  process.on("SIGHUP", onSighup)
  return {
    exit,
    exited,
    async fail(error: unknown): Promise<never> {
      exiting = true
      if (!input.renderer.isDestroyed) input.renderer.destroy()
      await cleanup().catch(() => {})
      completeExit()
      throw error
    },
  }
}

async function waitUntilDone(ready: Promise<void>, exited: Promise<void>) {
  await ready
  await exited
}
