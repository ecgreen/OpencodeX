export function subscribeSessionBrowserCaptures(input: {
  sessionID: () => string | undefined
  pasteFiles: (files: File[]) => Promise<void>
  focus: () => void
}) {
  const capture = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isBrowserCapture(event.detail) || event.detail.sessionID !== input.sessionID()) return
    void fetch(event.detail.dataURL)
      .then((response) => response.blob())
      .then((blob) => input.pasteFiles([new File([blob], safeCaptureFilename(event.detail.filename), { type: blob.type || "image/png" })]))
      .then(input.focus)
  }
  window.addEventListener("opencodex:workspace-browser-capture", capture)
  return () => window.removeEventListener("opencodex:workspace-browser-capture", capture)
}

function isBrowserCapture(value: unknown): value is { sessionID: string; dataURL: string; filename: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return typeof input.sessionID === "string" && typeof input.dataURL === "string" && input.dataURL.startsWith("data:image/png;base64,") && typeof input.filename === "string"
}

function safeCaptureFilename(value: string) {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim()
  return name.toLowerCase().endsWith(".png") ? name || "webpage.png" : `${name || "webpage"}.png`
}
