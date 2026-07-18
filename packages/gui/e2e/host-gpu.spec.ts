import { expect, test } from "@playwright/test"

test("uses a hardware graphics adapter for host visual validation", async ({ browser }, testInfo) => {
  test.skip(process.env.OPENCODEX_GUI_E2E_HOST_CHROME !== "1", "Host GPU validation only runs in the guarded host harness")

  const session = await browser.newBrowserCDPSession()
  const info = await session.send("SystemInfo.getInfo")
  await session.detach()
  await testInfo.attach("chrome-gpu-info", {
    body: JSON.stringify(info.gpu, null, 2),
    contentType: "application/json",
  })

  const adapters = info.gpu.devices.map((device) => `${device.vendorString} ${device.deviceString}`.trim())
  expect(adapters.length, "Chrome did not report a graphics adapter").toBeGreaterThan(0)
  expect(adapters.some((adapter) => /swiftshader|software rasterizer/i.test(adapter)), adapters.join("\n")).toBe(false)
  expect(info.gpu.featureStatus.gpu_compositing, JSON.stringify(info.gpu.featureStatus, null, 2)).not.toMatch(/disabled_software/i)
})
