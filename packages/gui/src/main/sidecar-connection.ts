const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

export function loopbackSidecarURL(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url
  } catch {
    // Invalid URLs are rejected below.
  }
  return undefined
}
