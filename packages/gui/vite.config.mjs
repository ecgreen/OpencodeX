import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const rendererPort = Number(process.env.OPENCODEX_GUI_RENDERER_PORT ?? "5173")

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

export default defineConfig({
  root: "src/renderer",
  plugins: [solid(), tailwindcss()],
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
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
  },
})
