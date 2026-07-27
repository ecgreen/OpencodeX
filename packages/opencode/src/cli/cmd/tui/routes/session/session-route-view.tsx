import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"
import { RGBA } from "@opentui/core"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { SplitBorder } from "@tui/component/border"
import { Prompt } from "@tui/component/prompt"
import { PathFormatterProvider } from "@tui/context/path-format"
import { useCommandShortcut } from "@tui/keymap"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { Toast } from "@tui/ui/toast"
import type { createSessionRouteController } from "./session-controller"
import { DialogMessage } from "./dialog-message"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { SessionAssistantMessage, SessionUserMessage } from "./session-messages"
import { SessionViewProvider } from "./session-view-context"
import { Sidebar } from "./sidebar"
import { SubagentFooter } from "./subagent-footer"

export function SessionRouteView(props: { controller: ReturnType<typeof createSessionRouteController> }) {
  return (
    <PathFormatterProvider path={props.controller.session()?.directory}>
      <SessionViewProvider value={{
        get width() {
          return props.controller.contentWidth()
        },
        sessionID: props.controller.route.sessionID,
        conceal: props.controller.conceal,
        thinkingMode: props.controller.thinkingMode,
        showThinking: props.controller.showThinking,
        showTimestamps: props.controller.showTimestamps,
        showDetails: props.controller.showDetails,
        showGenericToolOutput: props.controller.showGenericToolOutput,
        diffWrapMode: props.controller.diffWrapMode,
        providers: props.controller.providers,
        sync: props.controller.sync,
        tui: props.controller.tuiConfig,
      }}>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            <Show when={props.controller.session()}>
              <SessionTranscript controller={props.controller} />
              <SessionInput controller={props.controller} />
            </Show>
            <Toast />
          </box>
          <SessionSidebar controller={props.controller} />
        </box>
      </SessionViewProvider>
    </PathFormatterProvider>
  )
}

function SessionTranscript(props: { controller: ReturnType<typeof createSessionRouteController> }) {
  return (
    <scrollbox
      ref={props.controller.setScroll}
      viewportOptions={{ paddingRight: props.controller.showScrollbar() ? 1 : 0 }}
      verticalScrollbarOptions={{
        paddingLeft: 1,
        visible: props.controller.showScrollbar(),
        trackOptions: {
          backgroundColor: props.controller.theme.backgroundElement,
          foregroundColor: props.controller.theme.border,
        },
      }}
      stickyScroll={true}
      stickyStart="bottom"
      flexGrow={1}
      scrollAcceleration={props.controller.scrollAcceleration()}
    >
      <box height={1} />
      <For each={props.controller.messages()}>{(message, index) => (
        <Switch>
          <Match when={message.id === props.controller.revert()?.messageID}>
            <RevertedMessages controller={props.controller} />
          </Match>
          <Match when={props.controller.revert()?.messageID && message.id >= props.controller.revert()!.messageID}><></></Match>
          <Match when={message.role === "user"}>
            <SessionUserMessage
              index={index()}
              onMouseUp={() => {
                if (props.controller.renderer.getSelection()?.getSelectedText()) return
                props.controller.dialog.replace(() => (
                  <DialogMessage
                    messageID={message.id}
                    sessionID={props.controller.route.sessionID}
                    setPrompt={(prompt) => props.controller.prompt()?.set(prompt)}
                  />
                ))
              }}
              message={message as UserMessage}
              parts={props.controller.sync.data.part[message.id] ?? []}
              pending={props.controller.pending()}
            />
          </Match>
          <Match when={message.role === "assistant"}>
            <SessionAssistantMessage
              last={props.controller.lastAssistant()?.id === message.id}
              message={message as AssistantMessage}
              parts={props.controller.sync.data.part[message.id] ?? []}
            />
          </Match>
        </Switch>
      )}</For>
    </scrollbox>
  )
}

function RevertedMessages(props: { controller: ReturnType<typeof createSessionRouteController> }) {
  const shortcut = useCommandShortcut("session.redo")
  const [hover, setHover] = createSignal(false)
  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={async () => {
        const confirmed = await DialogConfirm.show(props.controller.dialog, "Confirm Redo", "Are you sure you want to restore the reverted messages?")
        if (confirmed) props.controller.keymap.dispatchCommand("session.redo")
      }}
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={props.controller.theme.backgroundPanel}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={hover() ? props.controller.theme.backgroundElement : props.controller.theme.backgroundPanel}>
        <text fg={props.controller.theme.textMuted}>{props.controller.revert()!.reverted.length} message reverted</text>
        <text fg={props.controller.theme.textMuted}><span style={{ fg: props.controller.theme.text }}>{shortcut()}</span> or /redo to restore</text>
        <Show when={props.controller.revert()!.diffFiles?.length}>
          <box marginTop={1}>
            <For each={props.controller.revert()!.diffFiles}>{(file) => (
              <text fg={props.controller.theme.text}>
                {file.filename}
                <Show when={file.additions > 0}><span style={{ fg: props.controller.theme.diffAdded }}> +{file.additions}</span></Show>
                <Show when={file.deletions > 0}><span style={{ fg: props.controller.theme.diffRemoved }}> -{file.deletions}</span></Show>
              </text>
            )}</For>
          </box>
        </Show>
      </box>
    </box>
  )
}

function SessionInput(props: { controller: ReturnType<typeof createSessionRouteController> }) {
  return (
    <box flexShrink={0}>
      <Show when={props.controller.permissions().length > 0}><PermissionPrompt request={props.controller.permissions()[0]} /></Show>
      <Show when={props.controller.permissions().length === 0 && props.controller.questions().length > 0}>
        <QuestionPrompt request={props.controller.questions()[0]} />
      </Show>
      <Show when={props.controller.session()?.parentID}><SubagentFooter /></Show>
      <Show when={props.controller.visible()}>
        <TuiPluginRuntime.Slot
          name="session_prompt"
          mode="replace"
          session_id={props.controller.route.sessionID}
          visible={props.controller.visible()}
          disabled={props.controller.disabled()}
          on_submit={props.controller.toBottom}
          ref={props.controller.bind}
        >
          <Prompt
            visible={props.controller.visible()}
            ref={props.controller.bind}
            disabled={props.controller.disabled()}
            onSubmit={props.controller.toBottom}
            sessionID={props.controller.route.sessionID}
            right={<TuiPluginRuntime.Slot name="session_prompt_right" session_id={props.controller.route.sessionID} />}
          />
        </TuiPluginRuntime.Slot>
      </Show>
    </box>
  )
}

function SessionSidebar(props: { controller: ReturnType<typeof createSessionRouteController> }) {
  return (
    <Show when={props.controller.sidebarVisible()}>
      <Switch>
        <Match when={props.controller.wide()}><Sidebar sessionID={props.controller.route.sessionID} /></Match>
        <Match when={!props.controller.wide()}>
          <box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="flex-end" backgroundColor={RGBA.fromInts(0, 0, 0, 70)}>
            <Sidebar sessionID={props.controller.route.sessionID} />
          </box>
        </Match>
      </Switch>
    </Show>
  )
}
