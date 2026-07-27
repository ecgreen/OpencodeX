import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SessionMessageAgentSwitched, SessionMessageAssistant, SessionMessageCompaction, SessionMessageModelSwitched, SessionMessageShell, SessionMessageUser } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js"
import { useSyncV2 } from "@tui/context/sync-v2"
import { useTheme } from "@tui/context/theme"
import { useBindings } from "../../keymap"
import { MissingData } from "./session-v2-tool-primitives"
import { AgentSwitchedMessage, AssistantMessage, CompactionMessage, ModelSwitchedMessage, ShellMessage, UnknownMessage, UserMessage } from "./session-v2-messages"

export function View(props: { api: TuiPluginApi; sessionID: string }) {
  const sync = useSyncV2()
  const dimensions = useTerminalDimensions()
  const { theme, syntax, subtleSyntax } = useTheme()
  const messages = createMemo(() => sync.data.messages[props.sessionID] ?? [])
  const renderedMessages = createMemo(() => messages().toReversed())
  const lastAssistant = createMemo(() => renderedMessages().findLast((message) => message.type === "assistant"))
  const lastUserCreated = (index: number) =>
    renderedMessages()
      .slice(0, index)
      .findLast((message) => message.type === "user")?.time.created

  createEffect(() => {
    void sync.session.message.sync(props.sessionID)
  })

  useBindings(() => ({
    bindings: [
      {
        key: "escape",
        desc: "Back to session",
        group: "Session",
        cmd() {
          props.api.route.navigate("session", { sessionID: props.sessionID })
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
          <scrollbox
            viewportOptions={{ paddingRight: 0 }}
            verticalScrollbarOptions={{ visible: false }}
            stickyScroll={true}
            stickyStart="bottom"
            flexGrow={1}
          >
            <box height={1} />
            <Show when={messages().length === 0}>
              <MissingData label="Messages" detail="No v2 messages loaded from useSyncV2 yet." />
            </Show>
            <For each={renderedMessages()}>
              {(message, index) => (
                <Switch>
                  <Match when={message.type === "user"}>
                    <UserMessage message={message as SessionMessageUser} index={index()} />
                  </Match>
                  <Match when={message.type === "assistant"}>
                    <AssistantMessage
                      message={message as SessionMessageAssistant}
                      sessionID={props.sessionID}
                      last={lastAssistant()?.id === message.id}
                      syntax={syntax()}
                      subtleSyntax={subtleSyntax()}
                      start={lastUserCreated(index())}
                    />
                  </Match>
                  <Match when={message.type === "synthetic"}>
                    <></>
                  </Match>
                  <Match when={message.type === "shell"}>
                    <ShellMessage message={message as SessionMessageShell} />
                  </Match>
                  <Match when={message.type === "compaction"}>
                    <CompactionMessage message={message as SessionMessageCompaction} />
                  </Match>
                  <Match when={message.type === "agent-switched"}>
                    <AgentSwitchedMessage message={message as SessionMessageAgentSwitched} />
                  </Match>
                  <Match when={message.type === "model-switched"}>
                    <ModelSwitchedMessage message={message as SessionMessageModelSwitched} />
                  </Match>
                  <Match when={true}>
                    <UnknownMessage message={message} />
                  </Match>
                </Switch>
              )}
            </For>
          </scrollbox>
          <MissingData
            label="Session prompt, permission prompt, question prompt, sidebar"
            detail="The v2 message endpoint only exposes messages, so these session UI regions cannot be rendered here. Press Esc to return to the live session."
          />
        </box>
      </box>
    </box>
  )
}
