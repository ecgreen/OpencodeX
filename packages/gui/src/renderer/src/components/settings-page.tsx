import { For, Show, createMemo } from "solid-js"
import type { createSettingsController } from "../controllers/settings-controller"
import type { PermissionModeOption } from "../lib/permission-mode"
import { Button, InlineNotice, Select, StatusBadge, SurfaceCard, Switch } from "./ui"

export function SettingsPage(props: { controller: ReturnType<typeof createSettingsController> }) {
  const transcriptSettings = createMemo(() => [
    {
      id: "conceal-code",
      label: "Conceal long code blocks",
      description: "Keep transcripts compact until code is deliberately expanded.",
      checked: props.controller.concealCodeBlocks,
      setChecked: props.controller.setConcealCodeBlocks,
    },
    {
      id: "timestamps",
      label: "Show message timestamps",
      description: "Display technical timestamps beside transcript messages.",
      checked: props.controller.showTimestamps,
      setChecked: props.controller.setShowTimestamps,
    },
    {
      id: "thinking",
      label: "Show reasoning content",
      description: "Include available reasoning sections in the transcript.",
      checked: props.controller.showThinking,
      setChecked: props.controller.setShowThinking,
    },
    {
      id: "tool-details",
      label: "Show tool details",
      description: "Expose structured inputs and results for agent tool calls.",
      checked: props.controller.showToolDetails,
      setChecked: props.controller.setShowToolDetails,
    },
    {
      id: "scrollbar",
      label: "Show transcript scrollbar",
      description: "Keep the native scrollbar visible on session transcripts.",
      checked: props.controller.showScrollbar,
      setChecked: props.controller.setShowScrollbar,
    },
    {
      id: "generic-output",
      label: "Show generic tool output",
      description: "Render raw output when a tool has no richer presentation.",
      checked: props.controller.showGenericToolOutput,
      setChecked: props.controller.setShowGenericToolOutput,
    },
  ])
  const lifecycle = createMemo(() => props.controller.lifecycle())
  const connectionLabel = createMemo(() => lifecycle()?.status.replaceAll("_", " ") ?? "starting")

  return (
    <main class="page settings-page">
      <header class="settings-header">
        <div>
          <p class="eyebrow">Preferences</p>
          <h1>Settings</h1>
          <p>Desktop preferences stay on this device. Security mode is stored separately in your OpenCodeX settings.</p>
        </div>
      </header>

      <div class="settings-layout">
        <section class="settings-section" aria-labelledby="settings-appearance">
          <header>
            <div>
              <h2 id="settings-appearance">Appearance</h2>
              <p>Use the same high-contrast hierarchy in dark or light environments.</p>
            </div>
          </header>
          <div class="theme-options" role="group" aria-label="Color theme">
            <For each={["dark", "light"] as const}>
              {(theme) => (
                <Button
                  appearance="ghost"
                  type="button"
                  class="theme-option"
                  classList={{ selected: props.controller.themeMode() === theme }}
                  aria-pressed={props.controller.themeMode() === theme}
                  onClick={() => props.controller.setThemeMode(theme)}
                >
                  <span class={`theme-preview ${theme}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>{theme === "dark" ? "Graphite dark" : "Precision light"}</strong>
                    <small>{theme === "dark" ? "Low-glare technical surfaces" : "Clear daylight contrast"}</small>
                  </span>
                </Button>
              )}
            </For>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="settings-transcript">
          <header>
            <div>
              <h2 id="settings-transcript">Transcript</h2>
              <p>Control information density without changing the centralized scrolling behavior.</p>
            </div>
          </header>
          <div class="settings-list">
            <For each={transcriptSettings()}>
              {(setting) => (
                <Switch class="settings-row" checked={setting.checked()} onChange={setting.setChecked}>
                  <span>
                    <strong>{setting.label}</strong>
                    <small>{setting.description}</small>
                  </span>
                </Switch>
              )}
            </For>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="settings-notifications">
          <header>
            <div>
              <h2 id="settings-notifications">Notifications</h2>
              <p>Desktop alerts only fire while the OpencodeX window is in the background.</p>
            </div>
          </header>
          <div class="settings-list">
            <Switch
              class="settings-row"
              checked={props.controller.attentionNotifications()}
              onChange={props.controller.setAttentionNotifications}
            >
              <span>
                <strong>Notify when work needs you</strong>
                <small>Raise a system notification for new permission, input, review, and failure items.</small>
              </span>
            </Switch>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="settings-security">
          <header>
            <div>
              <h2 id="settings-security">Security mode</h2>
              <p>Choose how OpenCodeX handles permission checks across projects and sessions.</p>
            </div>
          </header>
          <div class="settings-safety-card">
            <Select<PermissionModeOption>
              label="Security mode"
              description={
                props.controller.permissionModeOption()?.description ?? "Loading the global permission mode."
              }
              options={[...props.controller.permissionModeOptions]}
              current={props.controller.permissionModeOption()}
              optionValue={(option) => option.id}
              optionLabel={(option) => option.label}
              optionMeta={(option) => option.meta}
              optionDescription={(option) => option.description}
              onSelect={(option) => option && void props.controller.changePermissionMode(option.id)}
              loading={props.controller.savingPermissionMode()}
            />
            <Show when={props.controller.permissionMode() === "yolo"}>
              <InlineNotice tone="danger" title="Unrestricted agent access">
                YOLO mode bypasses prompts and explicit permission denials. It is not an operating-system sandbox.
              </InlineNotice>
            </Show>
            <Show when={props.controller.permissionModeError()}>
              {(message) => (
                <InlineNotice tone="danger" title="Permission mode unavailable">
                  {message()}
                </InlineNotice>
              )}
            </Show>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="settings-connection">
          <header>
            <div>
              <h2 id="settings-connection">Authoritative state</h2>
              <p>GUI and TUI project the same server-owned sessions, operations, and capabilities.</p>
            </div>
            <StatusBadge status={lifecycle()?.status ?? "starting"}>{connectionLabel()}</StatusBadge>
          </header>
          <SurfaceCard class="settings-connection-card">
            <div>
              <strong>{lifecycle()?.data === "stale" ? "Last snapshot retained" : "Shared state is current"}</strong>
              <span>
                {lifecycle()?.error ?? "No periodic authoritative requests are made while the client is idle."}
              </span>
            </div>
            <Show when={lifecycle()?.status === "error" || lifecycle()?.status === "reconnecting"}>
              <Button appearance="solid" tone="accent" onClick={() => void props.controller.retry()}>
                Retry now
              </Button>
            </Show>
          </SurfaceCard>
        </section>
      </div>
    </main>
  )
}
