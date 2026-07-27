import { expect, test } from "@playwright/test"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

test("keeps the browser address input embedded when focused", async ({ page, request }) => {
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()

  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Browser Address", directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = await projectResponse.json() as { id: string }
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: "Browser Address Session" },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)

  await page.getByRole("button", { name: /Browser Address Session/ }).first().click()
  await expect(page.locator(".session-page")).toBeVisible()
  await page.getByRole("button", { name: "Open side panel" }).click()
  await page.getByRole("button", { name: /^Webpage/ }).click()

  const input = page.getByRole("textbox", { name: "Web address or search" })
  await expect(input).toBeFocused()
  expect(await input.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      outlineWidth: style.outlineWidth,
    }
  })).toEqual({ borderWidth: "0px", boxShadow: "none", outlineWidth: "0px" })
  await expect(page.locator(".session-open-location")).toHaveCSS("border-top-width", "1px")
})
