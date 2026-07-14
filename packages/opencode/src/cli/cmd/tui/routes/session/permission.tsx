/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { createMemo, For, Match, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { isRecord } from "@/util/record"
import { useProject } from "../../context/project"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { PermissionChoicePrompt } from "./permission-choice"
import { PermissionRejectPrompt } from "./permission-reject"
import { PermissionRequestPrompt, PermissionTextBody } from "./permission-request"

type PermissionStage = "permission" | "always" | "reject"

export function PermissionPrompt(props: { request: PermissionRequest }) {
  const sdk = useSDK()
  const project = useProject()
  const sync = useSync()
  const toast = useToast()
  const themeState = useTheme()
  const [store, setStore] = createStore({ stage: "permission" as PermissionStage })
  const session = createMemo(() => sync.session.get(props.request.sessionID))
  const input = createMemo<Record<string, unknown>>(() => {
    const tool = props.request.tool
    if (!tool) return {}
    const part = (sync.data.part[tool.messageID] ?? []).find(
      (item) => item.type === "tool" && item.callID === tool.callID && item.state.status !== "pending",
    )
    return part?.type === "tool" && isRecord(part.state.input) ? part.state.input : {}
  })

  const reply = (value: { reply: "once" | "always" | "reject"; message?: string }) => {
    void sdk.client.permission
      .reply({
        ...value,
        requestID: props.request.id,
        workspace: project.workspace.current(),
      })
      .catch((error) => {
        toast.show({
          variant: "error",
          message: `Failed to answer permission: ${error instanceof Error ? error.message : String(error)}`,
          duration: 4000,
        })
      })
  }

  return (
    <Switch>
      <Match when={store.stage === "always"}>
        <PermissionChoicePrompt
          title="Always allow"
          body={
            props.request.always.length === 1 && props.request.always[0] === "*" ? (
              <PermissionTextBody title={`This will allow ${props.request.permission} until OpenCode is restarted.`} />
            ) : (
              <box paddingLeft={1} gap={1}>
                <text fg={themeState.theme.textMuted}>
                  This will allow the following patterns until OpenCode is restarted
                </text>
                <box>
                  <For each={props.request.always}>{(pattern) => <text fg={themeState.theme.text}>- {pattern}</text>}</For>
                </box>
              </box>
            )
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("stage", "permission")
            if (option === "confirm") reply({ reply: "always" })
          }}
        />
      </Match>
      <Match when={store.stage === "reject"}>
        <PermissionRejectPrompt
          onConfirm={(message) => reply({ reply: "reject", message: message || undefined })}
          onCancel={() => setStore("stage", "permission")}
        />
      </Match>
      <Match when={store.stage === "permission"}>
        <PermissionRequestPrompt
          request={props.request}
          input={input()}
          onSelect={(option) => {
            if (option === "always") {
              setStore("stage", "always")
              return
            }
            if (option === "reject" && session()?.parentID) {
              setStore("stage", "reject")
              return
            }
            reply({ reply: option })
          }}
        />
      </Match>
    </Switch>
  )
}
