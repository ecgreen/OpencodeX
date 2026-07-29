import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { compactPath } from "../lib/format"
import {
  guiPluginSafety,
  parseGuiPluginManifest,
  sampleGuiPlugins,
  serializeGuiPluginManifest,
  type GuiPluginManifest,
  type InstalledGuiPlugin,
} from "../lib/gui-plugins"
import type { GuiPlugin } from "../lib/session-api"
import { filterGuiPluginPagePlugins, filterPluginPagePlugins, guiPluginPageStats, pluginPageGroups, pluginPageStats } from "../lib/plugin-page-model"
import { Icon } from "./icon"
import { CardActionMenu } from "./card-action-menu"
import { Button, Checkbox, Select, TextArea, TextInput } from "./ui"

type PluginSurface = "gui" | "discover" | "share" | "runtime" | "safety"

export { filterGuiPluginPagePlugins, filterPluginPagePlugins, guiPluginPageStats, pluginPageGroups, pluginPageStats } from "../lib/plugin-page-model"

export function PluginsPage(props: {
  plugins: GuiPlugin[]
  guiPlugins: InstalledGuiPlugin[]
  refresh: () => void | Promise<void>
  install: (input: { spec: string; global?: boolean }) => Promise<void>
  toggle: (plugin: GuiPlugin) => Promise<void>
  installGuiPlugin: (manifest: GuiPluginManifest, source: InstalledGuiPlugin["source"]) => void
  toggleGuiPlugin: (id: string) => void
  removeGuiPlugin: (id: string) => void
}) {
  const [surface, setSurface] = createSignal<PluginSurface>("gui")
  const [spec, setSpec] = createSignal("")
  const [installGlobal, setInstallGlobal] = createSignal(false)
  const [busy, setBusy] = createSignal("")
  const [error, setError] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [scope, setScope] = createSignal<"all" | GuiPlugin["scope"]>("all")
  const [manifestText, setManifestText] = createSignal(serializeGuiPluginManifest(sampleGuiPlugins()[0]))
  const [shareText, setShareText] = createSignal("")
  const filtered = createMemo(() => filterPluginPagePlugins(props.plugins, scope(), query()))
  const filteredGuiPlugins = createMemo(() => filterGuiPluginPagePlugins(props.guiPlugins, query()))
  const stats = createMemo(() => pluginPageStats(props.plugins))
  const guiStats = createMemo(() => guiPluginPageStats(props.guiPlugins))
  const groups = createMemo(() => pluginPageGroups(filtered()))
  const samples = createMemo(() => sampleGuiPlugins())

  async function installRuntimePlugin(event: SubmitEvent) {
    event.preventDefault()
    const value = spec().trim()
    if (!value) {
      setError("Plugin package name is required.")
      return
    }
    setBusy("install")
    setError("")
    try {
      await props.install({ spec: value, global: installGlobal() })
      setSpec("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install plugin.")
    } finally {
      setBusy("")
    }
  }

  async function toggleRuntimePlugin(plugin: GuiPlugin) {
    setBusy(plugin.id)
    setError("")
    try {
      await props.toggle(plugin)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plugin.")
    } finally {
      setBusy("")
    }
  }

  function installGuiManifest(text: string, source: InstalledGuiPlugin["source"]) {
    const parsed = parseGuiPluginManifest(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const safety = guiPluginSafety(parsed.manifest)
    if (safety.blocked.length > 0) {
      setError(safety.blocked.join(" "))
      return
    }
    props.installGuiPlugin(parsed.manifest, source)
    setError("")
    setSurface("gui")
  }

  async function uploadGuiPlugin(file: File | undefined) {
    if (!file) return
    installGuiManifest(await file.text(), "imported")
  }

  function exportGuiPlugin(plugin: InstalledGuiPlugin) {
    setShareText(serializeGuiPluginManifest(plugin.manifest))
    setSurface("share")
  }

  return (
    <section class="page plugins-page">
      <header class="plugin-center-header">
        <div>
          <p class="eyebrow">Extensions</p>
          <h1>Plugin Center</h1>
          <p>Customize the GUI safely with declarative plugins, and manage runtime plugins separately.</p>
        </div>
        <div class="manager-actions">
          <Button appearance="outline" type="button" onClick={() => void props.refresh()}><Icon name="activity" /> Refresh runtime</Button>
        </div>
      </header>

      <nav class="plugin-center-tabs" aria-label="Plugin center sections">
        <For each={[
          { id: "gui", label: "GUI Plugins", icon: "panel" },
          { id: "discover", label: "Discover", icon: "star" },
          { id: "share", label: "Share", icon: "send" },
          { id: "runtime", label: "Runtime", icon: "settings" },
          { id: "safety", label: "Safety", icon: "check" },
        ] as const}>
          {(item) => (
            <Button appearance="ghost" type="button" classList={{ active: surface() === item.id }} onClick={() => setSurface(item.id)}>
              <Icon name={item.icon} /> {item.label}
            </Button>
          )}
        </For>
      </nav>

      <Show when={error()}>
        <div class="notice error">{error()}</div>
      </Show>

      <Switch>
        <Match when={surface() === "gui"}>
          <div class="plugin-summary">
            <div><strong>{guiStats().total}</strong><span>GUI plugins</span></div>
            <div><strong>{guiStats().enabled}</strong><span>Enabled</span></div>
            <div><strong>{guiStats().commands}</strong><span>Commands</span></div>
            <div><strong>{guiStats().themes}</strong><span>Themes</span></div>
          </div>

          <div class="plugin-toolbar">
            <label>
              <span>Search</span>
              <TextInput type="search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Filter GUI plugins, commands, snippets, or permissions" />
            </label>
            <div class="plugin-scope-filter">
              <Button appearance="ghost" type="button" onClick={() => setSurface("discover")}><Icon name="star" /> Discover</Button>
              <Button appearance="ghost" type="button" onClick={() => setSurface("share")}><Icon name="plus" /> Import</Button>
            </div>
          </div>

          <div class="gui-plugin-grid">
            <For each={filteredGuiPlugins()} fallback={<div class="empty">No GUI plugins installed yet. Open Discover to install a safe starter plugin.</div>}>
              {(plugin) => {
                const safety = createMemo(() => guiPluginSafety(plugin.manifest))
                return (
                  <article class={`gui-plugin-card risk-${safety().risk}`}>
                    <header>
                      <div>
                        <h2>{plugin.manifest.name}</h2>
                        <p>{plugin.manifest.description ?? "Declarative GUI customization plugin."}</p>
                      </div>
                      <span class={`plugin-state ${plugin.enabled ? "enabled" : "disabled"}`}>{plugin.enabled ? "enabled" : "disabled"}</span>
                    </header>
                    <div class="gui-plugin-meta">
                      <span>{plugin.manifest.id}@{plugin.manifest.version}</span>
                      <span>{plugin.source}</span>
                      <span>{safety().risk} risk</span>
                    </div>
                    <div class="plugin-capability-list">
                      <For each={plugin.manifest.permissions}>
                        {(permission) => <span>{permission}</span>}
                      </For>
                    </div>
                    <Show when={safety().warnings.length || safety().blocked.length}>
                      <div class="plugin-safety-note">
                        <For each={[...safety().warnings, ...safety().blocked]}>{(item) => <p>{item}</p>}</For>
                      </div>
                    </Show>
                    <div class="plugin-card-state">
                      <Button appearance="outline" type="button" onClick={() => props.toggleGuiPlugin(plugin.manifest.id)}>
                        <Icon name={plugin.enabled ? "stop" : "check"} /> {plugin.enabled ? "Disable" : "Enable"}
                      </Button>
                      <CardActionMenu label={plugin.manifest.name} actions={[
                        { label: "Export manifest", icon: "send", onSelect: () => exportGuiPlugin(plugin) },
                        { label: "Remove plugin", icon: "trash", danger: true, onSelect: () => props.removeGuiPlugin(plugin.manifest.id) },
                      ]} />
                    </div>
                  </article>
                )
              }}
            </For>
          </div>
        </Match>

        <Match when={surface() === "discover"}>
          <div class="plugin-marketplace-layout">
            <section class="plugin-marketplace-copy">
              <h2>GUI plugins are safe by default</h2>
              <p>Install declarative plugins for themes, command-palette prompts, snippets, and navigation affordances. They do not execute renderer code.</p>
            </section>
            <div class="gui-plugin-grid">
              <For each={samples()}>
                {(manifest) => {
                  const safety = guiPluginSafety(manifest)
                  return (
                    <article class={`gui-plugin-card risk-${safety.risk}`}>
                      <header>
                        <div>
                          <h2>{manifest.name}</h2>
                          <p>{manifest.description}</p>
                        </div>
                        <span class={`plugin-state ${safety.risk}`}>{safety.risk}</span>
                      </header>
                      <div class="plugin-capability-list">
                        <For each={manifest.permissions}>{(permission) => <span>{permission}</span>}</For>
                      </div>
                      <div class="plugin-card-state">
                        <Button appearance="solid" tone="accent" type="button" onClick={() => props.installGuiPlugin(manifest, "sample")}><Icon name="plus" /> Install</Button>
                        <Button appearance="outline" type="button" onClick={() => {
                          setManifestText(serializeGuiPluginManifest(manifest))
                          setSurface("share")
                        }}><Icon name="file" /> View manifest</Button>
                      </div>
                    </article>
                  )
                }}
              </For>
            </div>
          </div>
        </Match>

        <Match when={surface() === "share"}>
          <div class="plugin-share-layout">
            <section class="plugin-panel">
              <header>
                <div>
                  <strong>Import GUI plugin</strong>
                  <span>Paste JSON or upload a manifest file.</span>
                </div>
              </header>
              <TextArea value={manifestText()} onInput={(event) => setManifestText(event.currentTarget.value)} spellcheck={false} />
              <div class="plugin-card-state">
                <Button appearance="solid" tone="accent" type="button" onClick={() => installGuiManifest(manifestText(), "imported")}><Icon name="plus" /> Install manifest</Button>
                <label class="plugin-file-upload">
                  <Icon name="file" /> Upload JSON
                  <input type="file" accept="application/json,.json" onChange={(event) => void uploadGuiPlugin(event.currentTarget.files?.[0])} />
                </label>
              </div>
            </section>
            <section class="plugin-panel">
              <header>
                <div>
                  <strong>Share plugin</strong>
                  <span>Export an installed GUI plugin as portable JSON.</span>
                </div>
              </header>
              <Select<InstalledGuiPlugin>
                placeholder="Choose installed plugin"
                options={props.guiPlugins}
                optionValue={(plugin) => plugin.manifest.id}
                optionLabel={(plugin) => plugin.manifest.name}
                onSelect={(plugin) => setShareText(plugin ? serializeGuiPluginManifest(plugin.manifest) : "")}
              />
              <TextArea value={shareText()} readonly spellcheck={false} placeholder="Exported plugin JSON appears here." />
            </section>
          </div>
        </Match>

        <Match when={surface() === "runtime"}>
          <div class="plugin-runtime-layout">
            <div class="plugin-summary">
              <div><strong>{stats().total}</strong><span>Total</span></div>
              <div><strong>{stats().active}</strong><span>Active</span></div>
              <div><strong>{stats().disabled}</strong><span>Disabled</span></div>
              <div><strong>{stats().internal}</strong><span>Built in</span></div>
            </div>

            <form class="plugin-install-form" onSubmit={installRuntimePlugin}>
              <label>
                <span>Package</span>
                <TextInput type="text" value={spec()} onInput={(event) => setSpec(event.currentTarget.value)} placeholder="npm package name or local path" />
              </label>
              <Checkbox class="inline-checkbox" label="Install globally" checked={installGlobal()} onChange={setInstallGlobal} />
              <Button appearance="solid" tone="accent" type="submit" disabled={busy() === "install" || !spec().trim()}><Icon name="plus" /> {busy() === "install" ? "Installing..." : "Install runtime plugin"}</Button>
            </form>

            <div class="plugin-toolbar">
              <label>
                <span>Search runtime plugins</span>
                <TextInput type="search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Filter by package, id, source, or note" />
              </label>
              <div class="plugin-scope-filter" role="group" aria-label="Plugin scope">
                <For each={[
                  { value: "all", label: "All" },
                  { value: "internal", label: "Built in" },
                  { value: "local", label: "Local" },
                  { value: "global", label: "Global" },
                ] as const}>
                  {(item) => (
                    <Button appearance="ghost" type="button" class={scope() === item.value ? "active" : undefined} onClick={() => setScope(item.value)}>
                      {item.label}
                    </Button>
                  )}
                </For>
              </div>
            </div>

            <div class="plugin-groups">
              <For each={groups()}>
                {(group) => (
                  <section class="plugin-group">
                    <header>
                      <strong>{group.title}</strong>
                      <span>{group.items.length}</span>
                    </header>
                    <For each={group.items} fallback={<div class="empty">No {group.title.toLowerCase()} configured.</div>}>
                      {(plugin) => (
                        <article class="plugin-card">
                          <div>
                            <h2>{plugin.spec}</h2>
                            <p>{plugin.note ?? (plugin.kind === "tui" ? "Loads in the TUI runtime." : "Loads in the backend runtime.")}</p>
                            <div class="plugin-meta">
                              <small>{plugin.scope} - {compactPath(plugin.source)}</small>
                              <Show when={plugin.pluginID !== plugin.spec || plugin.target}>
                                <small>{plugin.pluginID !== plugin.spec ? `id ${plugin.pluginID}` : ""}{plugin.pluginID !== plugin.spec && plugin.target ? " - " : ""}{plugin.target ? `target ${plugin.target}` : ""}</small>
                              </Show>
                            </div>
                          </div>
                          <div class="plugin-card-state">
                            <span class={`plugin-state ${plugin.enabled ? "enabled" : "disabled"}`}>{plugin.enabled ? "enabled" : "disabled"}</span>
                            <span class={`plugin-state ${plugin.active ? "active" : "inactive"}`}>{plugin.active ? "active" : "inactive"}</span>
                            <Button
                              type="button"
                              appearance="outline"
                              tone={plugin.enabled ? "danger" : "neutral"}
                              disabled={!plugin.canToggle || busy() === plugin.id}
                              title={plugin.canToggle ? undefined : "This plugin kind cannot be toggled from the GUI yet."}
                              onClick={() => void toggleRuntimePlugin(plugin)}
                            >
                              <Icon name={plugin.enabled ? "stop" : "check"} /> {plugin.enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </article>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </div>
          </div>
        </Match>

        <Match when={surface() === "safety"}>
          <div class="plugin-safety-grid">
            <section class="plugin-panel">
              <header><strong>Safe GUI plugin model</strong></header>
              <p>GUI plugins are declarative JSON. They can contribute theme variables, snippets, and command-palette prompt actions. They cannot run JavaScript in the renderer.</p>
            </section>
            <section class="plugin-panel">
              <header><strong>Blocked by design</strong></header>
              <p>Network, filesystem, shell, browser automation, and backend hooks are blocked for GUI plugins until we have a reviewed permission broker.</p>
            </section>
            <section class="plugin-panel">
              <header><strong>Runtime plugin boundary</strong></header>
              <p>TUI and server plugins remain powerful runtime extensions. They are managed separately, should be reviewed like code, and may require restart or backend reload support.</p>
            </section>
          </div>
        </Match>
      </Switch>
    </section>
  )
}
