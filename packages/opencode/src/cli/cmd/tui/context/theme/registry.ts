import path from "path"
import { createStore } from "solid-js/store"
import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import aura from "./aura.json" with { type: "json" }
import ayu from "./ayu.json" with { type: "json" }
import carbonfox from "./carbonfox.json" with { type: "json" }
import catppuccin from "./catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./cobalt2.json" with { type: "json" }
import cursor from "./cursor.json" with { type: "json" }
import dracula from "./dracula.json" with { type: "json" }
import everforest from "./everforest.json" with { type: "json" }
import flexoki from "./flexoki.json" with { type: "json" }
import github from "./github.json" with { type: "json" }
import gruvbox from "./gruvbox.json" with { type: "json" }
import kanagawa from "./kanagawa.json" with { type: "json" }
import lucentOrng from "./lucent-orng.json" with { type: "json" }
import material from "./material.json" with { type: "json" }
import matrix from "./matrix.json" with { type: "json" }
import mercury from "./mercury.json" with { type: "json" }
import monokai from "./monokai.json" with { type: "json" }
import nightowl from "./nightowl.json" with { type: "json" }
import nord from "./nord.json" with { type: "json" }
import onedark from "./one-dark.json" with { type: "json" }
import opencode from "./opencode.json" with { type: "json" }
import orng from "./orng.json" with { type: "json" }
import osakaJade from "./osaka-jade.json" with { type: "json" }
import palenight from "./palenight.json" with { type: "json" }
import rosepine from "./rosepine.json" with { type: "json" }
import solarized from "./solarized.json" with { type: "json" }
import synthwave84 from "./synthwave84.json" with { type: "json" }
import tokyonight from "./tokyonight.json" with { type: "json" }
import vercel from "./vercel.json" with { type: "json" }
import vesper from "./vesper.json" with { type: "json" }
import zenburn from "./zenburn.json" with { type: "json" }
import type { ThemeJson } from "./types"

type ThemeState = {
  themes: Record<string, ThemeJson>
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  opencode,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}

const pluginThemes: Record<string, ThemeJson> = {}
let customThemes: Record<string, ThemeJson> = {}
let systemTheme: ThemeJson | undefined

export const [themeStore, setThemeStore] = createStore<ThemeState>({
  themes: listThemes(),
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false,
})

export function allThemes() {
  return themeStore.themes
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name || !isTheme(theme) || hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name || !isTheme(theme)) return false
  if (customThemes[name] !== undefined) customThemes[name] = theme
  else pluginThemes[name] = theme
  syncThemes()
  return true
}

export function setCustomThemes(themes: Record<string, ThemeJson>) {
  customThemes = themes
  syncThemes()
}

export function setSystemTheme(theme: ThemeJson | undefined) {
  systemTheme = theme
  syncThemes()
}

export async function loadCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(Filesystem.up({ targets: [".opencode"], start: process.cwd() }))),
  ]
  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for (const item of await Glob.scan("themes/*.json", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const name = path.basename(item, ".json")
      const theme = await Filesystem.readJson(item)
      if (isTheme(theme)) result[name] = theme
    }
  }
  return result
}

function listThemes() {
  const themes = { ...DEFAULT_THEMES, ...pluginThemes, ...customThemes }
  if (!systemTheme) return themes
  return { ...themes, system: systemTheme }
}

function syncThemes() {
  setThemeStore("themes", listThemes())
}

function isTheme(theme: unknown): theme is ThemeJson {
  return isRecord(theme) && isRecord(theme.theme)
}
