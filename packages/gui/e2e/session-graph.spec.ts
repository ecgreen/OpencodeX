import { expect, test, type Locator, type Page } from "@playwright/test"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
/** Merge nodes carry "into <parent title>", so titles alone are ambiguous. */
const SESSION_NODE = '.session-graph-node[data-graph-kind="session"]'
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

/**
 * Regression for the node-click freeze: clicking a graph node once locked the
 * whole app in a synchronous reactive loop. Every assertion after a click
 * doubles as a responsiveness probe - a frozen main thread answers nothing.
 */
test("opening the graph and clicking nodes keeps the app responsive", async ({ page, request }, testInfo) => {
  const suffix = `${path.basename(fixtureDirectory)}-${testInfo.retry}`
  const rootTitle = `Graph Root ${suffix}`

  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: `Graph Project ${suffix}`, directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project: { id: string } = await projectResponse.json()
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: rootTitle },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const root: { id: string } = await sessionResponse.json()

  // A delegation tree: two ordinary children, and one child tagged the way
  // swarm delegations are - which the session catalog deliberately hides, so
  // its node proves the graph's own children fetch works end to end.
  const childIDs: string[] = []
  for (const child of [
    { title: `Graph Child A ${suffix}` },
    { title: `Graph Child B ${suffix}` },
    { title: `Graph Hidden ${suffix}`, metadata: { opencodex: { swarmID: `swm-${suffix}` } } },
  ]) {
    const created = await request.post(`${backendURL}/session`, {
      headers,
      data: { parentID: root.id, ...child },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const createdChild: { id: string } = await created.json()
    const childID = createdChild.id
    childIDs.push(childID)
    const posted = await request.post(`${backendURL}/session/${childID}/message`, {
      headers,
      data: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        noReply: true,
        parts: [{ type: "text", text: `Delegated work for ${child.title}.` }],
      },
    })
    expect(posted.ok(), await posted.text()).toBe(true)
  }
  // A second layer, the shape a hand-off produces, with nothing said in it yet.
  const grandchild = await request.post(`${backendURL}/session`, {
    headers,
    data: {
      parentID: childIDs[0],
      title: `Graph Grandchild ${suffix}`,
      metadata: { opencodex: { swarmID: `swm-${suffix}`, swarmDepth: 2 } },
    },
  })
  expect(grandchild.ok(), await grandchild.text()).toBe(true)

  await page.goto("/")
  await page.locator(".session-link-shell", { hasText: rootTitle }).first().locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()

  // The graph is always one toolbar click away, whatever shape the tree is in.
  await openGraphTab(page)
  await expect(page.locator(".session-graph-canvas")).toBeVisible()

  // Every step renders - including the catalog-hidden swarm child and the
  // second-layer hand-off - plus a merge per delegating layer, and the markers.
  await expect(page.locator('.session-graph-node[data-graph-kind="session"]')).toHaveCount(5)
  await expect(page.locator(SESSION_NODE, { hasText: `Graph Hidden ${suffix}` })).toBeVisible()
  await expect(page.locator('.session-graph-node[data-graph-kind="join"]')).toHaveCount(2)
  expect(await page.locator(".session-graph-edge-marker").count()).toBeGreaterThan(0)

  // An edge marker's tooltip needs a background of its own: the token behind it
  // was misnamed upstream, which left every tooltip in the app transparent and
  // unreadable over the canvas.
  // Hovered on whichever card currently sits inside the canvas: a pipeline is
  // wider than the side panel, so which steps are on screen depends on the fit,
  // and an off-pane card cannot be scrolled to - the canvas pans by transform.
  await hoverVisibleNode(page)
  const tooltip = page.locator(".ui-tooltip").first()
  await expect(tooltip).toBeVisible()
  expect(await tooltip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
  // Move off the marker so the open tooltip is not floating over what the rest
  // of this test needs to click.
  await page.mouse.move(0, 0)
  await expect(page.locator(".ui-tooltip")).toHaveCount(0)
  await page.getByRole("button", { name: "Fit graph to view" }).click()

  // Click a node at default zoom: the embedded transcript replaces the top
  // session's, and the way back works.
  await page.locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` }).click()
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Child A ${suffix}`)
  await page.getByRole("button", { name: "Back to top session" }).click()
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)

  // The old freeze precondition: zoom until a node card is wider than the
  // pane, then select a node so the canvas has to reveal it. The canvas opens
  // fitted (well under 100%), so enough steps are needed to reach the 250%
  // clamp from any starting scale the fit can produce. dispatchEvent sidesteps
  // hit-testing, which cannot reach an off-viewport card, while still running
  // the exact click handler and reactive cascade.
  for (let step = 0; step < 14; step += 1) await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(page.locator(".session-graph-zoom-value")).toHaveText("250%")
  await page.locator(SESSION_NODE, { hasText: `Graph Child B ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Child B ${suffix}`)

  // The hidden swarm child opens too - its transcript hydrates even though
  // the catalog does not carry it.
  await page.locator(SESSION_NODE, { hasText: `Graph Hidden ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Hidden ${suffix}`)
  // Its transcript has to actually arrive, not just its header: a node that
  // opens to an empty pane tells the reader nothing about what the step did.
  await expect(page.locator(".session-graph-embedded .message").first()).toContainText(
    `Delegated work for Graph Hidden ${suffix}`,
  )

  // A step that has genuinely said nothing says so, rather than showing a pane
  // that is indistinguishable from a failed load.
  await page.locator(SESSION_NODE, { hasText: `Graph Grandchild ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Grandchild ${suffix}`)
  await expect(page.locator(".embedded-session-status")).toContainText("has not produced any messages")

  // Escape returns to the top session; the graph canvas is still alive.
  await page.keyboard.press("Escape")
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)
  await page.getByRole("button", { name: "Fit graph to view" }).click()
  await expect(page.locator(".session-graph-zoom-value")).not.toHaveText("250%")

  // Fullscreen workspace: the session column slides away and the panel takes
  // the whole window, under a toolbar that stays - it holds the way back.
  const workspace = page.locator(".session-side-panel.open")
  const sessionColumn = page.locator(".session-workspace")
  await expect(sessionColumn).toBeVisible()
  const shared = (await workspace.boundingBox())!.width
  // Genuinely on screen in the toolbar, not merely in the DOM: a clipped
  // control still answers a click, because the click scrolls it into view
  // first, so presence alone proves nothing.
  await expectWithin(page.getByRole("button", { name: "Fullscreen workspace" }), page.locator(".session-toolbar"))
  await page.getByRole("button", { name: "Fullscreen workspace" }).click()
  await expect(sessionColumn).toBeHidden()
  // It took the room the session gave up, rather than merely hiding it. Polled
  // because the width is a transition: sampled on the click it still reads as
  // the old value, which passes or fails on timing rather than on behaviour.
  await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(shared)
  // The content is genuinely full-height, not a strip: hiding the toolbar used
  // to drop .session-main into the page grid's `auto` row, which crushed the
  // fullscreen panel to ~100px with the canvas at zero.
  expect((await workspace.boundingBox())!.height).toBeGreaterThan(400)
  await expect(page.locator(".session-graph-canvas")).toBeVisible()
  expect((await page.locator(".session-graph-canvas").boundingBox())!.height).toBeGreaterThan(300)
  // The toolbar is still there, offering the way back on the same button.
  await expectWithin(page.getByRole("button", { name: "Exit fullscreen workspace" }), page.locator(".session-toolbar"))

  // Fullscreen drill-down: clicking a node must reveal its transcript *here*,
  // beside the graph, not render it into the hidden session column. This was
  // the central loop for large graphs, and it used to dead-end.
  await page.locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-drawer")).toBeVisible()
  await expect(page.locator(".session-graph-drawer .session-graph-embedded-heading")).toContainText(
    `Graph Child A ${suffix}`,
  )
  // The graph did not go anywhere: both are on screen at once, and the drawer
  // is measured *beside* the canvas, never over it - the two boxes must not
  // intersect, and the selected card stays inside the visible canvas.
  await expect(page.locator(".session-graph-canvas")).toBeVisible()
  await expect(sessionColumn).toBeHidden()
  {
    const canvasBox = (await page.locator(".session-graph-canvas").boundingBox())!
    const drawerBox = (await page.locator(".session-graph-drawer").boundingBox())!
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(drawerBox.x + 1)
    const selected = await page
      .locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` })
      .boundingBox()
    expect(selected).not.toBeNull()
    expect(selected!.x + selected!.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1)
  }
  // Switching workspace tabs takes the drawer with the Graph tab instead of
  // leaving it parked over the newcomer; coming back restores it.
  await page.getByRole("button", { name: "New tab" }).click()
  await page.getByRole("button", { name: "Git", exact: true }).click()
  await expect(page.locator(".session-graph-drawer")).toHaveCount(0)
  await page.getByRole("tab", { name: "Graph" }).click()
  await expect(page.locator(".session-graph-drawer")).toBeVisible()
  // Escape closes the drawer and hands focus back to the node that opened it.
  await page.keyboard.press("Escape")
  await expect(page.locator(".session-graph-drawer")).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-graph-node-id") ?? ""))
    .toContain("session:")

  // Closing the workspace while fullscreen restores the session instead of
  // emptying the window - the invariant that makes "everything closed"
  // unreachable.
  await page.getByRole("button", { name: "Close side panel" }).click()
  await expect(sessionColumn).toBeVisible()
  await expect(workspace).toHaveCount(0)

  await openGraphTab(page)
  await expect(page.locator(".session-graph-canvas")).toBeVisible()

  // Last, because it navigates away: "open as a full session" has to actually
  // leave the embedded pane behind. It used to route underneath a pane that
  // survived the change, so the button read as doing nothing at all.
  await page.locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` }).click()
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await page.getByRole("button", { name: "Open this step as a full session" }).click()
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)
  await expect(page.locator(".session-toolbar h1")).toContainText(`Graph Child A ${suffix}`)
})

/** The graph is a launcher card in the workspace fly-out, beside Git. */
async function openGraphTab(page: Page) {
  const panel = page.locator(".session-side-panel.open")
  if ((await panel.count()) === 0) await page.getByRole("button", { name: "Open side panel" }).click()
  await expect(panel).toBeVisible()
  // Which affordance appears depends on whether the panel restored any tabs,
  // and neither is there the instant the panel is: wait for one of them before
  // choosing, or the choice races the render and picks the absent branch.
  const card = page.locator('.session-open-empty-actions button[data-empty-tone="graph"]')
  const newTab = page.getByRole("button", { name: "New tab" })
  await expect(card.or(newTab).first()).toBeVisible()
  if ((await card.count()) > 0) {
    await card.click()
    return
  }
  await newTab.click()
  await page.getByRole("button", { name: "Graph", exact: true }).click()
}

/** Asserts a control is drawn inside its container, not clipped out of it. */
async function expectWithin(target: Locator, container: Locator) {
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  const bounds = await container.boundingBox()
  if (!box || !bounds) throw new Error("control or container has no box")
  expect({
    left: box.x >= bounds.x - 1,
    right: box.x + box.width <= bounds.x + bounds.width + 1,
    top: box.y >= bounds.y - 1,
    bottom: box.y + box.height <= bounds.y + bounds.height + 1,
  }).toEqual({ left: true, right: true, top: true, bottom: true })
}

/** Hovers the first node card whose box lies inside the canvas viewport. */
async function hoverVisibleNode(page: Page) {
  const canvas = await page.locator(".session-graph-canvas").boundingBox()
  if (!canvas) throw new Error("graph canvas has no box")
  const cards = page.locator(SESSION_NODE)
  for (let index = 0; index < (await cards.count()); index += 1) {
    const box = await cards.nth(index).boundingBox()
    if (!box) continue
    if (box.x < canvas.x || box.y < canvas.y) continue
    if (box.x + box.width > canvas.x + canvas.width || box.y + box.height > canvas.y + canvas.height) continue
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    return
  }
  throw new Error("no graph node is fully inside the canvas")
}
