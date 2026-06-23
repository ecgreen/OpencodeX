import { For, Show } from "solid-js"
import {
  workbenchArtifactOpenURL,
  type WorkbenchArtifact,
  type WorkbenchTab,
} from "../lib/workbench"
import { Icon } from "./icon"
import { Button, IconButton } from "./ui"

export function WorkbenchArtifactsPanel(props: {
  artifacts: WorkbenchArtifact[]
  setTab: (tab: WorkbenchTab) => void
  promptArtifact: (artifact: WorkbenchArtifact) => void
  openURL: (url: string | undefined, title?: string) => void
  clear: () => void
  deleteArtifact: (id: string) => void
}) {
  return (
    <section class="workbench-artifacts">
      <header class="workbench-artifacts-header">
        <div>
          <strong>{props.artifacts.length} artifact{props.artifacts.length === 1 ? "" : "s"}</strong>
          <span>Saved browser captures, file notes, and diff context.</span>
        </div>
        <div class="row-actions">
          <Button icon="browser" onClick={() => props.setTab("browser")}>Browser</Button>
          <Button variant="danger" icon="trash" disabled={props.artifacts.length === 0} onClick={props.clear}>Clear all</Button>
        </div>
      </header>
      <For
        each={props.artifacts}
        fallback={(
          <div class="workbench-empty-state">
            <strong>No artifacts yet</strong>
            <span>Capture a browser screenshot or ask an agent to save something useful from the Workbench.</span>
            <Button icon="panel" onClick={() => props.setTab("browser")}>Open browser</Button>
          </div>
        )}
      >
        {(artifact) => (
          <article class="workbench-artifact">
            <header>
              <div>
                <strong>{artifact.title}</strong>
                <span>{artifact.kind} - {new Date(artifact.created).toLocaleString()}</span>
              </div>
              <div class="row-actions">
                <IconButton icon="send" label={`Send ${artifact.title}`} onClick={() => props.promptArtifact(artifact)} />
                <Show when={workbenchArtifactOpenURL(artifact)}>
                  {(url) => <IconButton icon="browser" label={`Open ${artifact.title}`} onClick={() => props.openURL(url(), artifact.title)} />}
                </Show>
                <IconButton variant="danger" icon="trash" label={`Delete ${artifact.title}`} onClick={() => props.deleteArtifact(artifact.id)} />
              </div>
            </header>
            <Show when={artifact.kind === "screenshot" ? artifact.url : undefined}>
              {(url) => <img src={url()} alt={artifact.title} />}
            </Show>
            <Show when={artifact.kind === "link" && artifact.url ? artifact.url : undefined}>
              {(url) => <div class="workbench-artifact-link"><Icon name="browser" /><span>{url()}</span></div>}
            </Show>
            <Show when={artifact.text}><pre>{artifact.text}</pre></Show>
          </article>
        )}
      </For>
    </section>
  )
}
