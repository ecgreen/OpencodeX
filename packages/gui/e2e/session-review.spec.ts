import { expect, test } from "@playwright/test"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

test("returns a reviewed session to idle after it is opened", async ({ page, request }) => {
  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Review Status", directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = await projectResponse.json() as { id: string }
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: "Review Status Session" },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = await sessionResponse.json() as { id: string }
  const stateResponse = await request.patch(`${backendURL}/experimental/opencodex/session-state/${session.id}`, {
    headers,
    data: { seenAt: 0, reviewedAt: 0 },
  })
  expect(stateResponse.ok(), await stateResponse.text()).toBe(true)

  await page.goto("/")
  const sidebar = page.locator(".session-link-shell", { hasText: "Review Status Session" }).first()
  await expect(sidebar).toContainText("ready for review")
  await sidebar.locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()
  await expect(sidebar).toContainText("idle")

  await page.getByRole("button", { name: /^Dashboard:/ }).click()
  await expect(page.locator(".dashboard-active-sessions")).toContainText("No active sessions.")
  await expect(page.locator(".dashboard-active-sessions")).not.toContainText("Review Status Session")
})
