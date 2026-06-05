import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type GuiClient = {
  client: OpencodeClient
  url: string
  directory: string
  authHeader: string
}

function encodeBasic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`
}

export async function connectGuiClient(): Promise<GuiClient> {
  const connection = window.opencodex
    ? await window.opencodex.connection()
    : {
        url: import.meta.env.VITE_OPENCODEX_SERVER_URL ?? "http://127.0.0.1:4096",
        directory: import.meta.env.VITE_OPENCODEX_DIRECTORY ?? import.meta.env.PWD ?? "",
        username: import.meta.env.VITE_OPENCODEX_SERVER_USERNAME ?? "opencode",
        password: import.meta.env.VITE_OPENCODEX_SERVER_PASSWORD ?? "",
      }

  const directory = connection.directory ?? ""
  const authHeader = "password" in connection && connection.password ? encodeBasic(connection.username, connection.password) : ""
  const client = createOpencodeClient({
    baseUrl: connection.url,
    directory,
    headers: authHeader ? { authorization: authHeader } : undefined,
  })

  return { client, url: connection.url, directory, authHeader }
}
