export type GuiPluginPermission =
  | "theme"
  | "commands"
  | "snippets"
  | "navigation"
  | "network"
  | "filesystem"
  | "shell"
  | "browser"
  | "backend"

export type GuiPluginCommand = {
  id: string
  title: string
  prompt: string
  description?: string
}

export type GuiPluginSnippet = {
  id: string
  title: string
  text: string
  description?: string
}

export type GuiPluginManifest = {
  schema: "opencodex.gui.plugin/v1"
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  permissions: GuiPluginPermission[]
  contributes?: {
    theme?: {
      name?: string
      variables: Record<string, string>
    }
    commands?: GuiPluginCommand[]
    snippets?: GuiPluginSnippet[]
  }
}

export type InstalledGuiPlugin = {
  manifest: GuiPluginManifest
  enabled: boolean
  installedAt: number
  source: "sample" | "imported" | "local"
}

type GuiPluginThemeContribution = NonNullable<GuiPluginManifest["contributes"]>["theme"]

export type GuiPluginSafety = {
  risk: "low" | "medium" | "high"
  warnings: string[]
  blocked: string[]
}

const STORAGE_KEY = "opencodex.gui.plugins.v1"

const THEME_VARIABLES = new Set([
  "--accent",
  "--background",
  "--border",
  "--border-active",
  "--border-subtle",
  "--element",
  "--element-2",
  "--error",
  "--muted",
  "--panel",
  "--primary",
  "--success",
  "--syntax-comment",
  "--syntax-constant",
  "--syntax-critical",
  "--syntax-diff-add",
  "--syntax-diff-delete",
  "--syntax-info",
  "--syntax-keyword",
  "--syntax-object",
  "--syntax-operator",
  "--syntax-primitive",
  "--syntax-property",
  "--syntax-punctuation",
  "--syntax-regexp",
  "--syntax-string",
  "--syntax-success",
  "--syntax-type",
  "--syntax-variable",
  "--syntax-warning",
  "--text",
  "--warning",
])

const DECLARATIVE_PERMISSIONS = new Set<GuiPluginPermission>(["theme", "commands", "snippets", "navigation"])
const UNSUPPORTED_PERMISSIONS = new Set<GuiPluginPermission>(["network", "filesystem", "shell", "browser", "backend"])

export function readInstalledGuiPlugins(storage: Storage | undefined = globalStorage()) {
  if (!storage) return [] as InstalledGuiPlugin[]
  try {
    return normalizeInstalledPlugins(JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}

export function writeInstalledGuiPlugins(plugins: InstalledGuiPlugin[], storage: Storage | undefined = globalStorage()) {
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(plugins))
}

export function parseGuiPluginManifest(text: string) {
  try {
    return normalizeGuiPluginManifest(JSON.parse(text))
  } catch {
    return { ok: false as const, error: "Plugin manifest must be valid JSON." }
  }
}

export function normalizeGuiPluginManifest(input: unknown) {
  if (!isRecord(input)) return { ok: false as const, error: "Plugin manifest must be a JSON object." }
  if (input.schema !== "opencodex.gui.plugin/v1") return { ok: false as const, error: "Unsupported GUI plugin schema." }
  if (!isNonEmptyString(input.id) || !/^[a-z0-9][a-z0-9._:-]{1,80}$/i.test(input.id)) return { ok: false as const, error: "Plugin id must be 2-80 safe characters." }
  if (!isNonEmptyString(input.name)) return { ok: false as const, error: "Plugin name is required." }
  if (!isNonEmptyString(input.version)) return { ok: false as const, error: "Plugin version is required." }
  const permissions = Array.isArray(input.permissions)
    ? input.permissions.filter((item): item is GuiPluginPermission => typeof item === "string" && isGuiPluginPermission(item))
    : []
  const contributes = normalizeContributions(input.contributes)
  if (!contributes.ok) return contributes
  return {
    ok: true as const,
    manifest: {
      schema: "opencodex.gui.plugin/v1" as const,
      id: input.id,
      name: input.name,
      version: input.version,
      description: typeof input.description === "string" ? input.description : undefined,
      author: typeof input.author === "string" ? input.author : undefined,
      homepage: typeof input.homepage === "string" ? input.homepage : undefined,
      permissions,
      contributes: contributes.contributes,
    },
  }
}

export function installGuiPlugin(plugins: InstalledGuiPlugin[], manifest: GuiPluginManifest, source: InstalledGuiPlugin["source"]) {
  const next = {
    manifest,
    enabled: guiPluginSafety(manifest).risk !== "high",
    installedAt: Date.now(),
    source,
  }
  return [next, ...plugins.filter((plugin) => plugin.manifest.id !== manifest.id)]
}

export function guiPluginSafety(manifest: GuiPluginManifest): GuiPluginSafety {
  const unsupported = manifest.permissions.filter((permission) => UNSUPPORTED_PERMISSIONS.has(permission))
  const warnings = [
    ...(manifest.permissions.some((permission) => !DECLARATIVE_PERMISSIONS.has(permission))
      ? ["This plugin asks for capabilities outside the safe declarative GUI sandbox."]
      : []),
    ...(manifest.contributes?.theme
      ? invalidThemeVariables(manifest.contributes.theme.variables).map((name) => `${name} is not an allowed theme variable.`)
      : []),
  ]
  return {
    risk: unsupported.length > 0 ? "high" : warnings.length > 0 ? "medium" : "low",
    warnings,
    blocked: unsupported.map((permission) => `${permission} permission is not available to GUI plugins yet.`),
  }
}

export function guiPluginThemeCss(plugins: InstalledGuiPlugin[]) {
  const variables = Object.entries(
    plugins
      .filter((plugin) => plugin.enabled)
      .reduce<Record<string, string>>((result, plugin) => ({
        ...result,
        ...safeThemeVariables(plugin.manifest.contributes?.theme?.variables ?? {}),
      }), {}),
  )
  if (variables.length === 0) return ""
  return `:root{${variables.map(([name, value]) => `${name}:${value};`).join("")}}`
}

export function guiPluginCommands(plugins: InstalledGuiPlugin[]) {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) => plugin.manifest.contributes?.commands?.map((command) => ({ plugin, command })) ?? [])
}

export function serializeGuiPluginManifest(manifest: GuiPluginManifest) {
  return JSON.stringify(manifest, undefined, 2)
}

export function sampleGuiPlugins(): GuiPluginManifest[] {
  return [
    {
      schema: "opencodex.gui.plugin/v1",
      id: "studio.focus-theme",
      name: "Focus Theme",
      version: "0.1.0",
      description: "A quiet editor-forward theme for long coding sessions.",
      author: "OpencodeX",
      permissions: ["theme"],
      contributes: {
        theme: {
          name: "Focus",
          variables: {
            "--primary": "#7aa2f7",
            "--accent": "#9ece6a",
            "--panel": "#111318",
            "--element": "#171a21",
            "--element-2": "#202431",
            "--syntax-keyword": "#bb9af7",
            "--syntax-string": "#9ece6a",
            "--syntax-property": "#7dcfff",
          },
        },
      },
    },
    {
      schema: "opencodex.gui.plugin/v1",
      id: "studio.review-kit",
      name: "Review Kit",
      version: "0.1.0",
      description: "Adds command-palette prompts for code review and release checks.",
      author: "OpencodeX",
      permissions: ["commands", "snippets"],
      contributes: {
        commands: [
          {
            id: "review.current-work",
            title: "Review current work",
            description: "Ask the agent for a risk-first review.",
            prompt: "Review the current working tree. Prioritize bugs, regressions, missing tests, and risky UX changes.",
          },
          {
            id: "release.preview-check",
            title: "Run release preview checklist",
            description: "Ask the agent to inspect preview release readiness.",
            prompt: "Audit this branch for public preview readiness. Check GUI/TUI smoke paths, docs, package scripts, and release blockers.",
          },
        ],
        snippets: [
          {
            id: "pr-summary",
            title: "PR summary",
            text: "Summarize this change with: what changed, why, validation, and known risks.",
          },
        ],
      },
    },
  ]
}

function normalizeContributions(input: unknown): { ok: true; contributes: GuiPluginManifest["contributes"] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true as const, contributes: undefined }
  if (!isRecord(input)) return { ok: false as const, error: "Plugin contributions must be an object." }
  const theme = normalizeTheme(input.theme)
  if (!theme.ok) return theme
  const commands = normalizeCommands(input.commands)
  if (!commands.ok) return commands
  const snippets = normalizeSnippets(input.snippets)
  if (!snippets.ok) return snippets
  return {
    ok: true as const,
    contributes: {
      ...(theme.theme ? { theme: theme.theme } : {}),
      ...(commands.commands.length ? { commands: commands.commands } : {}),
      ...(snippets.snippets.length ? { snippets: snippets.snippets } : {}),
    },
  }
}

function normalizeTheme(input: unknown): { ok: true; theme: GuiPluginThemeContribution | undefined } | { ok: false; error: string } {
  if (input === undefined) return { ok: true as const, theme: undefined }
  if (!isRecord(input) || !isRecord(input.variables)) return { ok: false as const, error: "Theme contribution requires variables." }
  const variables = Object.fromEntries(
    Object.entries(input.variables)
      .filter((item): item is [string, string] => typeof item[1] === "string")
      .filter(([name, value]) => THEME_VARIABLES.has(name) && isSafeCssValue(value)),
  )
  return {
    ok: true as const,
    theme: {
      name: typeof input.name === "string" ? input.name : undefined,
      variables,
    },
  }
}

function normalizeCommands(input: unknown): { ok: true; commands: GuiPluginCommand[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: true as const, commands: [] as GuiPluginCommand[] }
  return {
    ok: true as const,
    commands: input.filter(isRecord).flatMap((item): GuiPluginCommand[] => {
      if (!isNonEmptyString(item.id) || !isNonEmptyString(item.title) || !isNonEmptyString(item.prompt)) return []
      return [{
        id: item.id,
        title: item.title,
        prompt: item.prompt,
        description: typeof item.description === "string" ? item.description : undefined,
      }]
    }),
  }
}

function normalizeSnippets(input: unknown): { ok: true; snippets: GuiPluginSnippet[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: true as const, snippets: [] as GuiPluginSnippet[] }
  return {
    ok: true as const,
    snippets: input.filter(isRecord).flatMap((item): GuiPluginSnippet[] => {
      if (!isNonEmptyString(item.id) || !isNonEmptyString(item.title) || !isNonEmptyString(item.text)) return []
      return [{
        id: item.id,
        title: item.title,
        text: item.text,
        description: typeof item.description === "string" ? item.description : undefined,
      }]
    }),
  }
}

function normalizeInstalledPlugins(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter(isRecord).flatMap((item): InstalledGuiPlugin[] => {
    const manifest = normalizeGuiPluginManifest(item.manifest)
    if (!manifest.ok) return []
    return [{
      manifest: manifest.manifest,
      enabled: item.enabled !== false,
      installedAt: typeof item.installedAt === "number" ? item.installedAt : Date.now(),
      source: item.source === "sample" || item.source === "local" ? item.source : "imported",
    }]
  })
}

function invalidThemeVariables(variables: Record<string, string>) {
  return Object.keys(variables).filter((name) => !THEME_VARIABLES.has(name))
}

function safeThemeVariables(variables: Record<string, string>) {
  return Object.fromEntries(Object.entries(variables).filter(([name, value]) => THEME_VARIABLES.has(name) && isSafeCssValue(value)))
}

function isSafeCssValue(value: string) {
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,% ]+\)|hsla?\([0-9.,% ]+\)|[a-z]+)$/i.test(value.trim())
}

function isGuiPluginPermission(input: string): input is GuiPluginPermission {
  return ["theme", "commands", "snippets", "navigation", "network", "filesystem", "shell", "browser", "backend"].includes(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0
}

function globalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
