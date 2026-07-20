import { expect, test } from "@playwright/test"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

test("keeps the authoritative connection current while prompting", async ({ page, request }) => {
  await page.addInitScript(() => Reflect.set(globalThis, "__opencodexPerformanceEnabled", true))
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Prompt Stream", directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = (await projectResponse.json()) as { id: string }
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: "Prompt Stream Session" },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  await sessionResponse.json()

  await page.getByRole("button", { name: /Prompt Stream Session/ }).first().click()
  const composer = page.getByRole("textbox", { name: "Message OpencodeX..." })
  await expect(composer).toBeVisible()
  await composer.fill("stream stays connected")
  await page.getByRole("button", { name: "Send message" }).click()
  await expect(composer).toHaveValue("")
  const running = page.getByRole("main").getByLabel("running")
  await expect(running).toBeVisible()
  await expect(running).toHaveCount(0, { timeout: 60_000 })

  await expect(page.locator(".sync-status-banner")).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      const details = Reflect.get(globalThis, "__opencodexPerformanceDetails") as {
        stateSync?: { reconnects?: number }
      }
      return details.stateSync?.reconnects
    }),
  ).toBe(0)
})
