import type { TuiPluginInstallResult } from "@opencode-ai/plugin/tui"
import path from "path"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { ConfigPlugin } from "@/config/plugin"
import { installPlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import { fail } from "./runtime-diagnostics"
import { addExternalPluginEntries, resolveExternalPlugins } from "./runtime-loader"
import { activatePluginEntry } from "./runtime-state"
import type { PluginLoad, RuntimeState } from "./runtime-types"

function defaultPluginOrigin(state: RuntimeState, spec: string): ConfigPlugin.Origin {
  return {
    spec,
    scope: "local",
    source: state.api.state.path.config || path.join(state.directory, ".opencode", "tui.json"),
  }
}

function installCause(error: unknown) {
  if (!error || typeof error !== "object") return
  if (!("cause" in error)) return
  return (error as { cause?: unknown }).cause
}

function installDetail(error: unknown) {
  const hit = installCause(error) ?? error
  if (!(hit instanceof Process.RunFailedError)) {
    return {
      message: errorMessage(hit),
      missing: false,
    }
  }

  const lines = hit.stderr
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const errors = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
  return {
    message: errors[0] ?? lines.at(-1) ?? errorMessage(hit),
    missing: lines.some((line) => line.includes("No version matching")),
  }
}

export async function addPluginBySpec(state: RuntimeState | undefined, raw: string) {
  if (!state) return false
  const spec = raw.trim()
  if (!spec) return false

  const config = state.pending.get(spec) ?? defaultPluginOrigin(state, spec)
  const next = ConfigPlugin.pluginSpecifier(config.spec)
  if (state.plugins.some((plugin) => plugin.load.spec === next)) {
    state.pending.delete(spec)
    return true
  }

  const ready = await resolveExternalPlugins([config], () => TuiConfig.waitForDependencies()).catch((error) => {
    fail("failed to add tui plugin", { path: next, error })
    return [] as PluginLoad[]
  })
  const first = ready[0]
  if (!first) {
    fail("failed to add tui plugin", { path: next })
    return false
  }
  if (state.plugins_by_id.has(first.id)) {
    state.pending.delete(spec)
    return true
  }

  const out = await addExternalPluginEntries(state, [first])
  const active = await Promise.all(out.plugins.map((plugin) => activatePluginEntry(state, plugin, false)))
  const ok = out.ok && out.plugins.length > 0 && active.every(Boolean)
  if (ok) state.pending.delete(spec)
  if (!ok) fail("failed to add tui plugin", { path: next })
  return ok
}

export async function installPluginBySpec(
  state: RuntimeState | undefined,
  raw: string,
  global = false,
): Promise<TuiPluginInstallResult> {
  if (!state) {
    return {
      ok: false,
      message: "Plugin runtime is not ready.",
    }
  }

  const spec = raw.trim()
  if (!spec) {
    return {
      ok: false,
      message: "Plugin package name is required",
    }
  }

  const dir = state.api.state.path
  if (!dir.directory) {
    return {
      ok: false,
      message: "Paths are still syncing. Try again in a moment.",
    }
  }

  const install = await installPlugin(spec)
  if (!install.ok) {
    const detail = installDetail(install.error)
    return {
      ok: false,
      message: detail.message,
      missing: detail.missing,
    }
  }

  const manifest = await readPluginManifest(install.target)
  if (!manifest.ok) {
    if (manifest.code === "manifest_no_targets") {
      return {
        ok: false,
        message: `"${spec}" does not expose plugin entrypoints or oc-themes in package.json`,
      }
    }
    return {
      ok: false,
      message: `Installed "${spec}" but failed to read ${manifest.file}`,
    }
  }

  const patch = await patchPluginConfig({
    spec,
    targets: manifest.targets,
    global,
    vcs: dir.worktree && dir.worktree !== "/" ? "git" : undefined,
    worktree: dir.worktree,
    directory: dir.directory,
  })
  if (!patch.ok) {
    if (patch.code === "invalid_json") {
      return {
        ok: false,
        message: `Invalid JSON in ${patch.file} (${patch.parse} at line ${patch.line}, column ${patch.col})`,
      }
    }
    return {
      ok: false,
      message: errorMessage(patch.error),
    }
  }

  const tui = manifest.targets.find((item) => item.kind === "tui")
  if (tui) {
    const file = patch.items.find((item) => item.kind === "tui")?.file
    state.pending.set(spec, {
      spec: tui.opts ? ([spec, tui.opts] as ConfigPlugin.Spec) : spec,
      scope: global ? "global" : "local",
      source: (file ?? dir.config) || path.join(patch.dir, "tui.json"),
    })
  }

  return {
    ok: true,
    dir: patch.dir,
    tui: Boolean(tui),
  }
}
