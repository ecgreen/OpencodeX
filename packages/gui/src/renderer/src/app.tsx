import type { JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, MessageBundle } from "./lib/store"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { connectGuiClient } from "./lib/client"
import { compactPath, formatRelative, title } from "./lib/format"
import { loadSession, loadSnapshot, sendPrompt, subscribeEvents } from "./lib/store"

type Route =
  | { name: "dashboard" }
  | { name: "session"; sessionID: string }
  | { name: "swarms" }
  | { name: "views" }

export function App() {
  const [client, setClient] = createSignal<GuiClient>()
  const [snapshot, setSnapshot] = createSignal<GuiSnapshot>()
  const [route, setRoute] = createSignal<Route>({ name: "dashboard" })
  const [messages, setMessages] = createSignal<MessageBundle[]>([])
  const [loading, setLoading] = createSignal("Starting sidecar")
  const [error, setError] = createSignal<string>()
  const [prompt, setPrompt] = createSignal("")

  const selectedSession = createMemo(() => {
    const current = route()
    if (current.name !== "session") return
    return snapshot()?.sessions.find((session) => session.id === current.sessionID)
  })

  async function refresh() {
    const gui = client()
    if (!gui) return
    setSnapshot(await loadSnapshot(gui))
  }

  async function syncSession(sessionID: string) {
    const gui = client()
    if (!gui) return
    setMessages(await loadSession(gui, sessionID))
  }

  onMount(async () => {
    try {
      const gui = await connectGuiClient()
      setClient(gui)
      setLoading("Loading workspace")
      await refresh()
      const unsubscribe = subscribeEvents(gui, () => {
        void refresh()
        const current = route()
        if (current.name === "session") void syncSession(current.sessionID)
      })
      onCleanup(unsubscribe)
      setLoading("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  })

  createEffect(() => {
    const current = route()
    if (current.name === "session") void syncSession(current.sessionID)
  })

  async function submitPrompt(event: SubmitEvent) {
    event.preventDefault()
    const gui = client()
    const session = selectedSession()
    const text = prompt().trim()
    if (!gui || !session || !text) return
    setPrompt("")
    await sendPrompt(gui, session.id, text)
    await syncSession(session.id)
    await refresh()
  }

  return (
    <div class="app-shell">
      <aside class="rail">
        <div class="brand" onClick={() => setRoute({ name: "dashboard" })}>
          <span class="brand-mark">OX</span>
          <div>
            <strong>OpencodeX</strong>
            <span>GUI Command Center</span>
          </div>
        </div>
        <nav class="nav">
          <button classList={{ active: route().name === "dashboard" }} onClick={() => setRoute({ name: "dashboard" })}>
            Dashboard
          </button>
          <button classList={{ active: route().name === "swarms" }} onClick={() => setRoute({ name: "swarms" })}>
            Swarms
          </button>
          <button classList={{ active: route().name === "views" }} onClick={() => setRoute({ name: "views" })}>
            Views
          </button>
        </nav>
        <section class="rail-section">
          <header>Recent Sessions</header>
          <For each={(snapshot()?.sessions ?? []).slice(0, 14)}>
            {(session) => (
              <button class="session-link" onClick={() => setRoute({ name: "session", sessionID: session.id })}>
                <span>{title(session.title)}</span>
                <small>{formatRelative(session.time.updated)}</small>
              </button>
            )}
          </For>
        </section>
      </aside>
      <main class="stage">
        <Show when={loading()}>
          <div class="loading-card">{loading()}...</div>
        </Show>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
        <Show when={!loading() && !error()}>
          <Switch>
            <Match when={route().name === "dashboard"}>
              <Dashboard snapshot={snapshot()} setRoute={setRoute} refresh={refresh} />
            </Match>
            <Match when={route().name === "session"}>
              <SessionPage session={selectedSession()} messages={messages()} prompt={prompt()} setPrompt={setPrompt} submit={submitPrompt} />
            </Match>
            <Match when={route().name === "swarms"}>
              <CollectionPage title="Swarms" count={snapshot()?.swarms.length ?? 0} description="Create, run, cancel, and inspect orchestrated swarm work through existing OpencodeX endpoints." />
            </Match>
            <Match when={route().name === "views"}>
              <CollectionPage title="Multi-Session Views" count={snapshot()?.views.length ?? 0} description="Open up to eight sessions together with per-pane focus and prompt targeting." />
            </Match>
          </Switch>
        </Show>
      </main>
    </div>
  )
}

function Dashboard(props: { snapshot?: GuiSnapshot; setRoute: (route: Route) => void; refresh: () => void }) {
  const active = createMemo(() => Object.values(props.snapshot?.sessionStatus ?? {}).filter((status) => status.type !== "idle").length)
  return (
    <div class="page dashboard-page">
      <header class="hero">
        <div>
          <p class="eyebrow">Live workspace</p>
          <h1>All OpencodeX work, one premium cockpit.</h1>
          <p>Projects, sessions, swarms, views, streaming events, and compatibility stay anchored to the existing backend data model.</p>
        </div>
        <button class="primary" onClick={props.refresh}>Refresh</button>
      </header>
      <section class="metric-grid">
        <Metric label="Projects" value={props.snapshot?.projects.length ?? 0} />
        <Metric label="Sessions" value={props.snapshot?.sessions.length ?? 0} />
        <Metric label="Active" value={active()} />
        <Metric label="Swarms" value={props.snapshot?.swarms.length ?? 0} />
        <Metric label="Views" value={props.snapshot?.views.length ?? 0} />
      </section>
      <section class="content-grid">
        <Panel title="Projects">
          <For each={props.snapshot?.projects ?? []} fallback={<Empty text="No OpencodeX projects yet" />}>
            {(project) => (
              <article class="card-row">
                <div>
                  <strong>{title(project.name ?? project.project.name)}</strong>
                  <span>{project.folders.length} folders · {project.sessions.length} sessions</span>
                </div>
                <small>{compactPath(project.folders[0]?.path)}</small>
              </article>
            )}
          </For>
        </Panel>
        <Panel title="Attention Needed">
          <For each={(props.snapshot?.jobs ?? []).filter((job) => ["input_needed", "approval_needed", "blocked", "failed"].includes(job.status)).slice(0, 8)} fallback={<Empty text="No blocked jobs" />}>
            {(job) => (
              <article class="card-row warning">
                <div>
                  <strong>{title(job.title ?? job.kind)}</strong>
                  <span>{job.status}</span>
                </div>
                <small>{formatRelative(job.timeUpdated)}</small>
              </article>
            )}
          </For>
        </Panel>
        <Panel title="Recent Sessions">
          <For each={(props.snapshot?.sessions ?? []).slice(0, 12)} fallback={<Empty text="No sessions" />}>
            {(session) => (
              <button class="card-row interactive" onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
                <div>
                  <strong>{title(session.title)}</strong>
                  <span>{compactPath(session.directory)}</span>
                </div>
                <StatusPill status={props.snapshot?.sessionStatus[session.id]?.type ?? "idle"} />
              </button>
            )}
          </For>
        </Panel>
        <Panel title="Swarms">
          <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<Empty text="No swarms" />}>
            {(swarm) => (
              <article class="card-row">
                <div>
                  <strong>{title(swarm.title)}</strong>
                  <span>{swarm.roles.length} roles · {swarm.runs.length} runs</span>
                </div>
                <StatusPill status={swarm.status} />
              </article>
            )}
          </For>
        </Panel>
      </section>
    </div>
  )
}

function SessionPage(props: { session?: Session; messages: MessageBundle[]; prompt: string; setPrompt: (value: string) => void; submit: (event: SubmitEvent) => void }) {
  const session = () => props.session
  return (
    <div class="page session-page">
      <Show when={session()} fallback={<Empty text="Session not found" />}>
        {(selected) => (
          <>
            <header class="session-header">
              <div>
                <p class="eyebrow">Session</p>
                <h1>{title(selected().title)}</h1>
                <p>{compactPath(selected().directory)}</p>
              </div>
            </header>
            <section class="transcript">
              <For each={props.messages} fallback={<Empty text="No transcript messages loaded" />}>
                {(bundle) => (
                  <article class={`message ${bundle.info.role}`}>
                    <header>{bundle.info.role}</header>
                    <For each={bundle.parts}>
                      {(part) => <PartView part={part} />}
                    </For>
                  </article>
                )}
              </For>
            </section>
            <form class="composer" onSubmit={props.submit}>
              <textarea value={props.prompt} onInput={(event) => props.setPrompt(event.currentTarget.value)} placeholder="Ask OpencodeX to build, inspect, refactor, test, or coordinate..." />
              <button class="primary" type="submit">Send</button>
            </form>
          </>
        )}
      </Show>
    </div>
  )
}

function PartView(props: { part: MessageBundle["parts"][number] }) {
  return (
    <Switch fallback={<pre class="part muted">{JSON.stringify(props.part, null, 2)}</pre>}>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <p class="part text">{"text" in props.part ? props.part.text : ""}</p>
      </Match>
      <Match when={props.part.type === "tool"}>
        <div class="part tool">
          <strong>{props.part.type === "tool" ? props.part.tool : "tool"}</strong>
          <span>{props.part.type === "tool" ? props.part.state.status : ""}</span>
        </div>
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="part file">File: {props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</div>
      </Match>
    </Switch>
  )
}

function CollectionPage(props: { title: string; count: number; description: string }) {
  return (
    <div class="page placeholder-page">
      <p class="eyebrow">Parity area</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      <div class="metric-card large"><strong>{props.count}</strong><span>records available through existing backend APIs</span></div>
    </div>
  )
}

function Panel(props: { title: string; children: JSX.Element }) {
  return <section class="panel"><h2>{props.title}</h2>{props.children}</section>
}

function Metric(props: { label: string; value: number }) {
  return <div class="metric-card"><span>{props.label}</span><strong>{props.value}</strong></div>
}

function StatusPill(props: { status: string }) {
  return <span class={`status ${props.status.replaceAll("_", "-")}`}>{props.status}</span>
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}
