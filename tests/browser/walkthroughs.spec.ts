import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { gitFixtureRoot } from "./git-fixture.ts"
import { gitApiOrigin } from "./ports.ts"

// The fixture repository is built by the git server's webServer command.
test.skip(() => !existsSync(path.join(gitFixtureRoot, ".git")), "git is not installed")

const title = "How run finds its answer"
// Tests run in parallel against one server, so each publishes its own title.
const presentTitle = "Present how run finds its answer"
const progressTitle = "Progress through run's answer"

function walkthrough(id: string, head: string, name = title) {
  return {
    project: gitFixtureRoot,
    id,
    title: name,
    summary: "A short tour of `src/app.ts`.",
    steps: [
      { title: "What this covers", body: "The constant, the function, and the **uncommitted** change." },
      { title: "run returns the constant", body: "`run` hands back `answer`.", file: { path: "src/app.ts", lines: [3, 5] } },
      { title: "The README at HEAD", body: "Pinned to a commit.", file: { path: "README.md", lines: [1, 1], at: head.slice(0, 7) } },
      { title: "The answer went from 1 to 2", body: "The working tree bumps it.", diff: { compare: { kind: "working" }, path: "src/app.ts", lines: [1, 1] } },
      { title: "Written against older code", body: "This line moved on.", file: { path: "src/app.ts", lines: [1, 1], expect: "export const answer = 99" } },
    ],
  }
}

test("a published walkthrough steps through a note, a file, a snapshot, a diff, and a changed step", async ({ page, request }) => {
  const head = execFileSync("git", ["-C", gitFixtureRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const id = "browser-tour"
  const published = await request.post(`${gitApiOrigin}/api/walkthroughs`, { data: walkthrough(id, head) })
  expect(published.status()).toBe(201)
  const { url }: { url: string } = await published.json()

  try {
    await page.goto(url)
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
    const steps = page.getByRole("listbox", { name: "Steps" })
    await expect(steps.getByRole("option")).toHaveCount(6)
    await expect(page.getByRole("tab", { name: title })).toHaveAttribute("aria-selected", "true")

    await page.getByRole("button", { name: "Start walkthrough" }).click()
    const note = page.getByRole("region", { name: "Step 1 of 5: What this covers" })
    await expect(note).toContainText("uncommitted")
    await expect(steps.getByRole("option", { selected: true })).toHaveAccessibleName(/^Step 1 of 5: What this covers/)
    const panelTop = (await note.boundingBox())?.y

    await page.keyboard.press("ControlOrMeta+ArrowRight")
    await expect(page).toHaveURL(/path=src%2Fapp\.ts.*step=2#L3-L5$/)
    const source = page.getByRole("textbox", { name: "TypeScript source" })
    await expect(source.locator(".source-document-line.selected")).toHaveCount(3)
    // The story is in the panel above the document, in the same place on
    // every step; the code keeps a marker under the step's lines (0135).
    const sourceNarration = page.getByRole("region", { name: "Step 2 of 5: run returns the constant" })
    await expect(sourceNarration).toContainText("hands back")
    expect((await sourceNarration.boundingBox())?.y).toBe(panelTop)
    await expect(source.getByRole("region")).toHaveCount(0)
    await expect(source.locator(".step-marker")).toHaveText("Step 2")

    // Lines outside the step's range step back.
    await expect(source.locator(".source-document-line.unfocused")).toHaveCount(2)
    await expect(page.getByRole("tab", { name: "app.ts" })).toHaveAttribute("data-preview", "true")

    // The next step's tab replaces the preview tab in place.
    await page.keyboard.press("ControlOrMeta+ArrowRight")
    await expect(page.getByRole("tab", { name: `README.md @ ${head.slice(0, 7)}` })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "app.ts" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Step 3 of 5: The README at HEAD" })).toBeVisible()

    await page.getByRole("button", { name: "Next Step" }).click()
    await expect(page).toHaveURL(/review=working.*step=4#f=src\/app\.ts&R1$/)
    const diffNarration = page.getByRole("region", { name: "Step 4 of 5: The answer went from 1 to 2" })
    await expect(diffNarration).toContainText("bumps it")
    await expect(diffNarration.getByRole("note")).toHaveCount(0)
    expect((await diffNarration.boundingBox())?.y).toBe(panelTop)
    await expect(page.locator("main .step-marker")).toHaveText("Step 4")

    // Collapsing folds the story to its header, for the steps after it too.
    await diffNarration.getByRole("button", { name: "Collapse Explanation" }).click()
    await expect(diffNarration.getByText("bumps it")).toBeHidden()
    await page.keyboard.press("ControlOrMeta+ArrowRight")
    const changed = page.getByRole("region", { name: "Step 5 of 5: Written against older code" })
    await expect(changed.getByText("This line moved on.")).toBeHidden()
    await changed.getByRole("button", { name: "Expand Explanation" }).click()
    await expect(changed.getByText("This line moved on.")).toBeVisible()
    expect((await changed.boundingBox())?.y).toBe(panelTop)
    const drift = changed.getByRole("note")
    await expect(drift).toContainText("changed after the step was written")
    await expect(drift.getByRole("definition").first()).toHaveText("export const answer = 99")
    await expect(drift.getByRole("definition").last()).toHaveText("export const answer = 2")
    await expect(changed.getByRole("button", { name: "Next Step" })).toHaveCount(0)
    await expect(changed.getByRole("button", { name: "Finish" })).toBeVisible()

    await changed.getByRole("button", { name: "Previous Step" }).click()
    await expect(page).toHaveURL(/step=4/)

    await page.getByRole("region", { name: /^Step 4 of 5/ }).getByRole("button", { name: "Close Walkthrough" }).click()
    await expect(page).not.toHaveURL(/wt=/)
    await expect(page.getByRole("region", { name: /^Step \d of 5/ })).toHaveCount(0)
    await expect(page.getByRole("listbox", { name: "Walkthroughs" }).getByRole("option", { name: new RegExp(`^${title}`) })).toBeVisible()
  } finally {
    await request.delete(`${gitApiOrigin}/api/walkthroughs?project=${encodeURIComponent(gitFixtureRoot)}&id=${id}`)
  }
})

test("present mode hides the chrome until Escape, and phones step from the panel", async ({ page, request }) => {
  const head = execFileSync("git", ["-C", gitFixtureRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const id = "browser-present"
  const published = await request.post(`${gitApiOrigin}/api/walkthroughs`, { data: walkthrough(id, head, presentTitle) })
  expect(published.status()).toBe(201)
  const { url }: { url: string } = await published.json()
  const panel = (step: number) => page.getByRole("region", { name: new RegExp(`^Step ${step} of 5`) })

  try {
    await page.goto(`${url}&step=2#L3-L5`)
    await page.getByRole("button", { name: "Present", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "Views" })).toBeHidden()
    await expect(page.getByRole("tablist", { name: "Open documents" })).toBeHidden()
    await expect(page.locator(".status-bar")).toBeHidden()

    // The panel carries the step controls and the way out; no bar floats
    // over the code (decision 0135).
    await expect(page.getByRole("toolbar")).toHaveCount(0)
    await expect(panel(2).getByRole("button", { name: "Stop Presenting" })).toBeVisible()
    await panel(2).getByRole("button", { name: "Next Step" }).click()
    await expect(panel(3)).toBeVisible()
    // Plain arrows step while presenting, as slides do.
    await page.keyboard.press("ArrowRight")
    await expect(panel(4)).toBeVisible()
    await page.keyboard.press("ArrowLeft")
    await expect(panel(3)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(panel(3).getByRole("button", { name: "Stop Presenting" })).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible()
    await expect(page).toHaveURL(/step=3/)

    // Phones start with the story folded, so the code keeps the screen.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel(3).getByRole("button", { name: "Expand Explanation" })).toBeVisible()
    await expect(panel(3).getByText("Pinned to a commit.")).toBeHidden()
    await panel(3).getByRole("button", { name: "Previous Step" }).click()
    await expect(panel(2)).toBeVisible()
    await panel(2).getByRole("button", { name: "Steps" }).click()
    const steps = page.getByRole("listbox", { name: "Steps" })
    await expect(steps).toBeVisible()
    await steps.getByRole("option", { name: /^Step 4 of 5/ }).click()
    await expect(steps).toBeHidden()
    await expect(panel(4)).toBeVisible()
  } finally {
    await request.delete(`${gitApiOrigin}/api/walkthroughs?project=${encodeURIComponent(gitFixtureRoot)}&id=${id}`)
  }
})

test("a diff step shows Unified, and a layout chosen during the walkthrough is not saved", async ({ page, request }) => {
  const head = execFileSync("git", ["-C", gitFixtureRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const id = "browser-unified"
  const published = await request.post(`${gitApiOrigin}/api/walkthroughs`, { data: walkthrough(id, head, "Unified diffs in run's answer") })
  expect(published.status()).toBe(201)
  const { url }: { url: string } = await published.json()
  // Wide enough that Split has room beside the sidebar and the Files rail.
  await page.setViewportSize({ width: 1800, height: 900 })
  const layout = (name: "Split" | "Unified") => page.getByRole("group", { name: "Diff layout" }).getByRole("button", { name })
  const openDiffStep = async () => {
    await page.goto(url)
    await page.getByRole("listbox", { name: "Steps" }).getByRole("option", { name: /^Step 4 of 5/ }).click()
    await expect(page).toHaveURL(/review=working.*step=4/)
  }

  try {
    await openDiffStep()
    await expect(page.getByRole("region", { name: /^Step 4 of 5/ })).toBeVisible()
    await expect(layout("Unified")).toHaveAttribute("aria-pressed", "true")
    await layout("Split").click()
    await expect(layout("Split")).toHaveAttribute("aria-pressed", "true")
    expect(await page.evaluate(() => window.localStorage.getItem("zero-diff-options"))).toBeNull()

    await page.getByRole("region", { name: /^Step 4 of 5/ }).getByRole("button", { name: "Close Walkthrough" }).click()
    await expect(page).not.toHaveURL(/wt=/)
    await page.evaluate(() => window.localStorage.setItem("zero-diff-options", JSON.stringify({ style: "split" })))
    await openDiffStep()
    // A new walkthrough session starts Unified again over the saved Split.
    await expect(layout("Unified")).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("region", { name: /^Step 4 of 5/ }).getByRole("button", { name: "Close Walkthrough" }).click()
    await expect(layout("Split")).toHaveAttribute("aria-pressed", "true")
  } finally {
    await request.delete(`${gitApiOrigin}/api/walkthroughs?project=${encodeURIComponent(gitFixtureRoot)}&id=${id}`)
  }
})

test("progress: new marks, a pinned preview tab, resume, read checks, and finish", async ({ page, request }) => {
  const head = execFileSync("git", ["-C", gitFixtureRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const id = "browser-progress"
  const published = await request.post(`${gitApiOrigin}/api/walkthroughs`, { data: walkthrough(id, head, progressTitle) })
  expect(published.status()).toBe(201)
  const { url }: { url: string } = await published.json()

  try {
    // A walkthrough not opened yet is marked new in the list.
    await page.goto(url.replace(/&wt=[^&#]*/, ""))
    await page.getByRole("button", { name: /^Walkthroughs/ }).click()
    const list = page.getByRole("listbox", { name: "Walkthroughs" })
    await expect(list.getByRole("option", { name: new RegExp(`^${progressTitle}, new,`) })).toBeVisible()
    await list.getByRole("option", { name: new RegExp(`^${progressTitle}`) }).click()

    await page.getByRole("button", { name: "Start walkthrough" }).click()
    await page.keyboard.press("ControlOrMeta+ArrowRight")
    await expect(page).toHaveURL(/step=2/)

    // Double-click pins the preview tab, so the next step opens beside it.
    const appTab = page.getByRole("tab", { name: "app.ts" })
    await appTab.dblclick()
    await expect(appTab).not.toHaveAttribute("data-preview")
    await page.keyboard.press("ControlOrMeta+ArrowRight")
    await expect(page).toHaveURL(/step=3/)
    await expect(appTab).toBeVisible()

    // Read steps are checked, and the cover offers to resume.
    const steps = page.getByRole("listbox", { name: "Steps" })
    await expect(steps.getByRole("option", { name: /^Step 2 of 5: .*, read$/ })).toBeVisible()
    await page.goto(url)
    await page.getByRole("button", { name: "Resume at step 3" }).click()
    await expect(page).toHaveURL(/step=3/)

    // A step link reveals the walkthrough's steps beside it.
    await page.getByRole("button", { name: /^Source Control/ }).click()
    await expect(steps).toBeHidden()
    await page.goto(`${url}&path=src%2Fapp.ts&step=2#L3-L5`)
    await expect(steps).toBeVisible()

    // Finishing the last step leads the cover with a completion line.
    await steps.getByRole("option", { name: /^Step 5 of 5/ }).click()
    await page.getByRole("region", { name: /^Step 5 of 5/ }).getByRole("button", { name: "Finish" }).click()
    await expect(page.getByRole("heading", { name: "You finished this walkthrough" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: progressTitle })).toBeVisible()
    await expect(page.locator(".walkthrough-cover-meta")).toContainText("finished")
  } finally {
    await request.delete(`${gitApiOrigin}/api/walkthroughs?project=${encodeURIComponent(gitFixtureRoot)}&id=${id}`)
  }
})
