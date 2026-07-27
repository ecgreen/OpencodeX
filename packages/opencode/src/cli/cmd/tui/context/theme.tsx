import { CliRenderEvents, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useTuiConfig } from "./tui-config"
import {
  allThemes,
  hasTheme,
  loadCustomThemes,
  setCustomThemes,
  setSystemTheme,
  setThemeStore,
  themeStore,
} from "./theme/registry"
import { resolveTheme } from "./theme/resolve"
import { generateSubtleSyntax, generateSyntax } from "./theme/syntax"
import { generateSystem } from "./theme/system"

export { addTheme, allThemes, DEFAULT_THEMES, hasTheme, upsertTheme } from "./theme/registry"
export { resolveTheme, selectedForeground } from "./theme/resolve"
export { generateSubtleSyntax, generateSyntax } from "./theme/syntax"
export { generateSystem, tint } from "./theme/system"
export type { ThemeJson } from "./theme/types"

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const renderer = useRenderer()
    const config = useTuiConfig()
    const kv = useKV()
    const pick = (value: unknown) => value === "dark" || value === "light" ? value : undefined

    setThemeStore(
      produce((draft) => {
        const lock = pick(kv.get("theme_mode_lock"))
        const mode = lock ?? pick(renderer.themeMode) ?? props.mode
        if (!lock && pick(kv.get("theme_mode")) !== undefined) kv.set("theme_mode", undefined)
        draft.mode = mode
        draft.lock = lock
        const active = config.theme ?? kv.get("theme", "opencode")
        draft.active = typeof active === "string" ? active : "opencode"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme
      if (theme) setThemeStore("active", theme)
    })

    function init() {
      void Promise.allSettled([
        resolveSystemTheme(themeStore.mode),
        loadCustomThemes()
          .then(setCustomThemes)
          .catch(() => setThemeStore("active", "opencode")),
      ]).finally(() => setThemeStore("ready", true))
    }

    onMount(init)

    function resolveSystemTheme(mode: "dark" | "light" = themeStore.mode) {
      return renderer
        .getPalette({ size: 16 })
        .then((colors: TerminalColors) => {
          if (!colors.palette[0]) {
            setSystemTheme(undefined)
            if (themeStore.active === "system") setThemeStore("active", "opencode")
            return
          }
          setSystemTheme(generateSystem(colors, mode))
        })
        .catch(() => {
          setSystemTheme(undefined)
          if (themeStore.active === "system") setThemeStore("active", "opencode")
        })
    }

    function apply(mode: "dark" | "light") {
      if (themeStore.lock !== undefined) kv.set("theme_mode", mode)
      if (themeStore.mode === mode) return
      setThemeStore("mode", mode)
      renderer.clearPaletteCache()
      void resolveSystemTheme(mode)
    }

    function pin(mode: "dark" | "light" = themeStore.mode) {
      setThemeStore("lock", mode)
      kv.set("theme_mode_lock", mode)
      apply(mode)
    }

    function free() {
      setThemeStore("lock", undefined)
      kv.set("theme_mode_lock", undefined)
      kv.set("theme_mode", undefined)
      const mode = renderer.themeMode
      if (mode) apply(mode)
    }

    const handle = (mode: "dark" | "light") => {
      if (themeStore.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handle)

    const refresh = () => {
      renderer.clearPaletteCache()
      init()
    }
    process.on("SIGUSR2", refresh)
    onCleanup(() => {
      renderer.off(CliRenderEvents.THEME_MODE, handle)
      process.off("SIGUSR2", refresh)
    })

    const values = createMemo(() => {
      const active = themeStore.themes[themeStore.active]
      if (active) return resolveTheme(active, themeStore.mode)
      const saved = kv.get("theme")
      if (typeof saved === "string") {
        const theme = themeStore.themes[saved]
        if (theme) return resolveTheme(theme, themeStore.mode)
      }
      return resolveTheme(themeStore.themes.opencode, themeStore.mode)
    })

    createEffect(() => renderer.setBackgroundColor(values().background))
    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error theme keys are resolved through the current memo value.
          return values()[prop]
        },
      }),
      get selected() {
        return themeStore.active
      },
      all() {
        return allThemes()
      },
      has(name: string) {
        return hasTheme(name)
      },
      syntax,
      subtleSyntax,
      mode() {
        return themeStore.mode
      },
      locked() {
        return themeStore.lock !== undefined
      },
      lock() {
        pin(themeStore.mode)
      },
      unlock() {
        free()
      },
      setMode(mode: "dark" | "light") {
        pin(mode)
      },
      set(theme: string) {
        if (!hasTheme(theme)) return false
        setThemeStore("active", theme)
        kv.set("theme", theme)
        return true
      },
      get ready() {
        return themeStore.ready
      },
    }
  },
})
