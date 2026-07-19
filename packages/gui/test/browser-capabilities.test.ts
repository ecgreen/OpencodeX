import { expect, test } from "bun:test"
import {
  BROWSER_SNAPSHOT_MAX_BYTES,
  BROWSER_SNAPSHOT_MAX_ITEMS,
  shapeBrowserSnapshot,
  validExternalBrowserURL,
} from "../src/main/browser-capabilities"

test("external browser URLs allow only absolute HTTP(S) URLs", () => {
  expect(validExternalBrowserURL("https://example.test/path?q=1")).toBe("https://example.test/path?q=1")
  expect(validExternalBrowserURL("http://localhost:3000")).toBe("http://localhost:3000/")
  expect(validExternalBrowserURL("mailto:user@example.test")).toBeUndefined()
  expect(validExternalBrowserURL("javascript:alert(1)")).toBeUndefined()
  expect(validExternalBrowserURL("example.test")).toBeUndefined()
  expect(validExternalBrowserURL(42)).toBeUndefined()
})

test("browser snapshots redact passwords and stay within item and byte limits", () => {
  const snapshot = shapeBrowserSnapshot({
    url: `https://example.test/${"u".repeat(4_000)}`,
    title: " Example   page ",
    bodyText: `${"visible text ".repeat(3_000)}${"界".repeat(24_000)}`,
    items: [
      {
        tag: "INPUT",
        label: "Password",
        name: "password",
        value: "do-not-return-this",
        type: "password",
        disabled: false,
      },
      ...Array.from({ length: 250 }, (_, index) => ({
        tag: "a",
        text: `Link ${index} ${"x".repeat(1_000)}`,
        href: `https://example.test/${index}/${"h".repeat(3_000)}`,
      })),
    ],
  })

  expect(snapshot).toBeDefined()
  expect(snapshot?.url.length).toBe(2_048)
  expect(snapshot?.title).toBe("Example page")
  expect(snapshot?.items[0]).toEqual({
    tag: "input",
    label: "Password",
    name: "password",
    value: "[REDACTED]",
    type: "password",
    disabled: false,
  })
  expect(snapshot?.items.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_MAX_ITEMS)
  expect(Buffer.byteLength(JSON.stringify(snapshot), "utf8")).toBeLessThanOrEqual(BROWSER_SNAPSHOT_MAX_BYTES)
  expect(JSON.stringify(snapshot)).not.toContain("do-not-return-this")
})

test("browser snapshot shaping rejects non-object results and malformed items", () => {
  expect(shapeBrowserSnapshot("snapshot")).toBeUndefined()
  expect(shapeBrowserSnapshot({ url: 1, title: null, bodyText: [], items: [null, {}, { tag: "button" }] })).toEqual({
    url: "",
    title: "",
    bodyText: "",
    items: [{ tag: "button" }],
  })
})
