const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

export type ConfiguredBackendConnection = {
  url: string
  username: string
  password: string
  directory: string
}

export function loopbackSidecarURL(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url
  } catch {
    // Invalid URLs are rejected below.
  }
  return undefined
}

export function configuredBackendConnection(env: NodeJS.ProcessEnv = process.env): ConfiguredBackendConnection | undefined {
  const value = env.OPENCODEX_GUI_SERVER_URL
  if (!value) return
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OPENCODEX_GUI_SERVER_URL must use HTTP or HTTPS")
  }
  if (url.username || url.password) throw new Error("OPENCODEX_GUI_SERVER_URL must not contain credentials")
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("OPENCODEX_GUI_SERVER_URL must be an origin without a path, query, or fragment")
  }
  if (/[;\s]/.test(url.hostname)) throw new Error("OPENCODEX_GUI_SERVER_URL contains an invalid host")
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname) && !enabled(env.OPENCODEX_GUI_ALLOW_INSECURE)) {
    throw new Error("Non-loopback OPENCODEX_GUI_SERVER_URL must use HTTPS or set OPENCODEX_GUI_ALLOW_INSECURE=1")
  }
  return {
    url: url.origin,
    username: env.OPENCODEX_GUI_SERVER_USERNAME ?? "opencode",
    password: env.OPENCODEX_GUI_SERVER_PASSWORD ?? "",
    directory: env.OPENCODEX_GUI_DIRECTORY ?? process.cwd(),
  }
}

export function configuredBackendConnectSource(connection: ConfiguredBackendConnection | undefined) {
  return connection?.url
}

export function restartOwnedSidecar<Connection>(
  configured: ConfiguredBackendConnection | undefined,
  restart: () => Promise<Connection>,
) {
  if (configured) return Promise.reject(new Error("Configured backend restart is not managed by this client."))
  return restart()
}

function enabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true"
}
