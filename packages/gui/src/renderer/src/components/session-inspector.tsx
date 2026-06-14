import type { LspStatus, McpStatus, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import type { SessionData } from "../lib/store"
import { formatTodoStatus } from "../lib/tool-display"

type InspectorState = Record<string, boolean>

const STORAGE_KEY = "opencodex.gui.sessionInspector"
const PANEL_STORAGE_KEY = "opencodex.gui.sessionInspectorPanel"

export function SessionInspector(props: {
  session: Session
  data: SessionData
  providers: Provider[]
  mcp: Record<string, McpStatus>
  lsp: LspStatus[]
  lspEnabled?: boolean
}) {
  const [collapsed, setCollapsed] = createSignal(readInspectorState())
  const [open, setOpen] = createSignal(readInspectorPanelOpen())
  const model = createMemo(() => sessionInspectorModel({
    session: props.session,
    data: props.data,
    providers: props.providers,
    mcp: props.mcp,
    lsp: props.lsp,
    lspEnabled: props.lspEnabled,
  }))
  const toggle = (section: string) => {
    setCollapsed((current) => {
      const next = { ...current, [section]: !current[section] }
      writeInspectorState(next)
      return next
    })
  }
  const setPanelOpen = (value: boolean) => {
    setOpen(value)
    writeInspectorPanelOpen(value)
  }
  return (
    <Show
      when={open()}
      fallback={
        <button type="button" class="session-inspector-restore" title="Show context" aria-label="Show session context" onClick={() => setPanelOpen(true)}>
          Context
        </button>
      }
    >
      <aside class="session-inspector" aria-label="Session context">
        <div class="session-inspector-header">
          <strong>Context</strong>
          <button type="button" title="Hide context" aria-label="Hide session context" onClick={() => setPanelOpen(false)}>-</button>
        </div>
        <InspectorSection id="context" title="Usage" collapsed={collapsed().context} toggle={toggle}>
          <div class="inspector-metrics">
            <Metric label="Tokens" value={model().context.tokens ? model().context.tokens.toLocaleString() : "0"} />
            <Metric label="Context" value={model().context.percent === undefined ? "unknown" : `${model().context.percent}%`} />
            <Metric label="Cost" value={model().context.cost} />
          </div>
        </InspectorSection>
        <Show when={model().visibleSections.mcp}>
          <InspectorSection id="mcp" title="MCP" collapsed={collapsed().mcp} toggle={toggle}>
            <For each={model().mcpRows}>
              {([name, status]) => <StatusRow name={name} status={status.status} detail={"error" in status ? status.error : undefined} />}
            </For>
          </InspectorSection>
        </Show>
        <Show when={model().visibleSections.lsp}>
          <InspectorSection id="lsp" title="LSP" collapsed={collapsed().lsp} toggle={toggle}>
            <Show when={props.lsp.length > 0} fallback={<p class="inspector-empty">{props.lspEnabled === false ? "LSPs are disabled" : "LSPs will activate as files are read"}</p>}>
              <For each={props.lsp}>
                {(item) => <StatusRow name={item.id || item.name} status={item.status} detail={item.root} />}
              </For>
            </Show>
          </InspectorSection>
        </Show>
        <Show when={model().visibleSections.todo}>
          <InspectorSection id="todo" title="Todo" collapsed={collapsed().todo} toggle={toggle}>
            <For each={model().activeTodos}>
              {(todo) => (
                <div class={`inspector-todo ${todo.status}`}>
                  <span>{formatTodoStatus(todo.status)}</span>
                  <strong>{todo.content}</strong>
                  <small>{todo.priority}</small>
                </div>
              )}
            </For>
          </InspectorSection>
        </Show>
        <Show when={model().visibleSections.files}>
          <InspectorSection id="files" title="Modified Files" collapsed={collapsed().files} toggle={toggle}>
            <For each={props.data.diffs}>
              {(file) => (
                <div class="inspector-file">
                  <span>{file.file}</span>
                  <small><b class="diff-additions">+{file.additions}</b><b class="diff-deletions">-{file.deletions}</b></small>
                </div>
              )}
            </For>
          </InspectorSection>
        </Show>
      </aside>
    </Show>
  )
}

function InspectorSection(props: { id: string; title: string; collapsed?: boolean; toggle: (id: string) => void; children: JSX.Element }) {
  return (
    <section class="session-inspector-section">
      <button type="button" aria-expanded={!props.collapsed} onClick={() => props.toggle(props.id)}>
        <strong>{props.title}</strong>
        <span>{props.collapsed ? "+" : "-"}</span>
      </button>
      <Show when={!props.collapsed}>
        <div>{props.children}</div>
      </Show>
    </section>
  )
}

function Metric(props: { label: string; value: string }) {
  return <div><span>{props.label}</span><strong>{props.value}</strong></div>
}

function StatusRow(props: { name: string; status: string; detail?: string }) {
  return (
    <div class={`inspector-status ${props.status}`}>
      <span>{props.name}</span>
      <small>{props.detail ?? labelStatus(props.status)}</small>
    </div>
  )
}

export function sessionInspectorModel(input: {
  session: Session
  data: SessionData
  providers: Provider[]
  mcp: Record<string, McpStatus>
  lsp: LspStatus[]
  lspEnabled?: boolean
}) {
  const activeTodos = input.data.todos.filter((todo) => todo.status !== "completed")
  const mcpRows = Object.entries(input.mcp).toSorted(([left], [right]) => left.localeCompare(right))
  return {
    activeTodos,
    context: sessionContext(input.session, input.data, input.providers),
    mcpRows,
    visibleSections: {
      todo: activeTodos.length > 0,
      files: input.data.diffs.length > 0,
      mcp: mcpRows.length > 0,
      lsp: input.lsp.length > 0 || input.lspEnabled !== undefined,
    },
  }
}

function sessionContext(session: Session, data: SessionData, providers: Provider[]) {
  const last = data.messages.findLast((bundle) => bundle.info.role === "assistant" && "tokens" in bundle.info && bundle.info.tokens.output > 0)
  const info = last?.info.role === "assistant" ? last.info : undefined
  const tokens = info
    ? info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cache.read + info.tokens.cache.write
    : 0
  const limit = info
    ? providers.find((provider) => provider.id === info.providerID)?.models[info.modelID]?.limit.context
    : undefined
  return {
    tokens,
    percent: limit && tokens ? Math.round((tokens / limit) * 100) : undefined,
    cost: money(session.cost ?? 0),
  }
}

function labelStatus(status: string) {
  if (status === "needs_auth") return "Needs auth"
  if (status === "needs_client_registration") return "Needs client ID"
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
}

function readInspectorState(): InspectorState {
  if (typeof localStorage === "undefined") return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
  } catch {
    return {}
  }
}

function writeInspectorState(value: InspectorState) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

function readInspectorPanelOpen() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(PANEL_STORAGE_KEY) === "open"
}

function writeInspectorPanelOpen(value: boolean) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(PANEL_STORAGE_KEY, value ? "open" : "closed")
}
