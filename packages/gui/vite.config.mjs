import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const rendererPort = Number(process.env.OPENCODEX_GUI_RENDERER_PORT ?? "5173")
const backendOrigin = process.env.VITE_OPENCODEX_SERVER_URL
  ? new URL(process.env.VITE_OPENCODEX_SERVER_URL).origin
  : undefined
const rendererCsp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "worker-src 'self' blob:",
  [
    "connect-src 'self'",
    "http://127.0.0.1:*",
    "ws://127.0.0.1:*",
    "http://localhost:*",
    "ws://localhost:*",
    ...(backendOrigin ? [backendOrigin] : []),
    "data:",
  ].join(" "),
].join("; ")

function rendererVendorChunk(id) {
  const path = id.replaceAll("\\", "/")
  if (path.includes("/node_modules/@xterm/")) return "vendor-terminal"
  if (
    path.includes("/node_modules/marked/") ||
    path.includes("/node_modules/marked-katex-extension/") ||
    path.includes("/node_modules/marked-shiki/") ||
    path.includes("/node_modules/katex/")
  ) return "vendor-markdown"
}

if (!Number.isInteger(rendererPort) || rendererPort < 1 || rendererPort > 65_535) {
  throw new Error("OPENCODEX_GUI_RENDERER_PORT must be a valid TCP port.")
}

/*
 * `--mode lab` builds only the standalone component lab (lab.html) into its own
 * directory. The default build keeps index.html as the sole entry, so the lab
 * never adds anything to the shipped Electron renderer.
 */
export default defineConfig(({ mode }) => ({
  root: "src/renderer",
  plugins: [solid(), tailwindcss()],
  base: "./",
  build: {
    outDir: mode === "lab" ? "../../dist/lab" : (process.env.OPENCODEX_GUI_RENDERER_OUT_DIR ?? "../../dist/renderer"),
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      ...(mode === "lab" ? { input: "src/renderer/lab.html" } : {}),
      output: {
        manualChunks: rendererVendorChunk,
        onlyExplicitManualChunks: true,
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: rendererPort,
    strictPort: true,
    headers: { "Content-Security-Policy": rendererCsp },
  },
  preview: { headers: { "Content-Security-Policy": rendererCsp } },
}))
