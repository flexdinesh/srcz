import { existsSync } from "node:fs"
import path from "node:path"

import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { test } from "./live-test.ts"

import { copiedText, grantClipboard, recordClipboard } from "./clipboard.ts"
import { gitFixtureRoot } from "./git-fixture.ts"

// Review feedback threads (decision 0120). Each test serves its own copy of
// the git fixture, so its repository's feedback starts empty.
test.skip(() => !existsSync(path.join(gitFixtureRoot, ".git")), "git is not installed")
test.use({ seed: gitFixtureRoot })

function reviewFile(page: Page, file: string) {
  return page.getByRole("main").getByRole("region", { name: file, exact: true })
}

function gutter(page: Page, file: string, side: "deletions" | "additions", line: number) {
  return reviewFile(page, file).locator(`.diff-view [data-${side}] [data-column-number="${line}"]`)
}

function thread(page: Page, number: number) {
  return page.getByRole("region", { name: new RegExp(`^Thread ${number}: `) })
}

async function feedbackId(request: APIRequestContext, origin: string, root: string): Promise<string> {
  const response = await request.get(`${origin}/api/feedback?project=${encodeURIComponent(root)}`)
  expect(response.ok()).toBe(true)
  const { id }: { id: string } = await response.json()
  return id
}

async function comment(page: Page, file: string, line: number, body: string) {
  await gutter(page, file, "additions", line).click()
  await page.keyboard.press("c")
  const composer = page.getByRole("textbox", { name: `Comment on ${file}:${line}` })
  await expect(composer).toBeFocused()
  await composer.fill(body)
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(composer).toHaveCount(0)
}

test("lines in a review take a comment, replies, an agent's answer, and resolve", async ({ page, request, live }) => {
  // A long walk through one review: WebKit takes most of the default 30 s.
  test.setTimeout(60_000)
  const project = encodeURIComponent(live.root)
  await page.goto(`${live.origin}/view?project=${project}&review=working#f=src/app.ts`)
  await expect(gutter(page, "src/app.ts", "additions", 1)).toBeVisible({ timeout: 20_000 })

  // C opens the composer at the selection; submitting clears the selection.
  await comment(page, "src/app.ts", 1, "Name the **answer** after what it counts.")
  const first = thread(page, 1)
  await expect(first).toHaveAccessibleName("Thread 1: Open, src/app.ts:1")
  await expect(first.locator("strong")).toHaveText("answer")
  await expect(first.locator(".feedback-message-author")).toHaveText("you")
  await expect(page).toHaveURL(/#f=src\/app\.ts$/)

  // The gutter's Comment button opens the same composer.
  await gutter(page, "src/app.ts", "additions", 4).click()
  await page.getByRole("button", { name: "Comment on Lines" }).click()
  await page.getByRole("textbox", { name: "Comment on src/app.ts:4" }).fill("Two spaces, as before.")
  await page.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(thread(page, 2)).toHaveAccessibleName("Thread 2: Open, src/app.ts:4")

  // Cancel keeps the draft for the same anchor in this session.
  await gutter(page, "src/app.ts", "additions", 3).click()
  await page.keyboard.press("c")
  await page.getByRole("textbox", { name: "Comment on src/app.ts:3" }).fill("Draft")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("textbox", { name: "Comment on src/app.ts:3" })).toHaveCount(0)
  await page.getByRole("button", { name: "Comment on Lines" }).click()
  await expect(page.getByRole("textbox", { name: "Comment on src/app.ts:3" })).toHaveValue("Draft")
  await page.getByRole("button", { name: "Cancel" }).click()

  // A reply sends with Cmd/Ctrl+Enter.
  const reply = page.getByRole("textbox", { name: "Reply to thread 1" })
  await reply.fill("Maybe `count`?")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(first.locator(".feedback-message")).toHaveCount(2)
  await expect(reply).toHaveValue("")

  // An agent's reply arrives over the live stream.
  const id = await feedbackId(request, live.origin, live.root)
  expect(id).toMatch(/^fb-[a-z2-7]{6}$/)
  const answered = await request.post(`${live.origin}/api/feedback-messages`, {
    data: { project: live.root, id, thread: 1, body: "Renamed it to `count`.", author: "agent", name: "codex" },
  })
  expect(answered.ok()).toBe(true)
  await expect(first.locator(".feedback-message-author").last()).toHaveText("agent · codex")

  // Resolve collapses the thread to one line; Show resolved comments hides it.
  await first.getByRole("button", { name: "Resolve" }).click()
  await expect(first).toHaveAccessibleName("Thread 1: Resolved, src/app.ts:1")
  await expect(first.getByRole("button", { name: /after what it counts\./ })).toBeVisible()
  await page.getByRole("button", { name: "View options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show resolved comments" }).click()
  await page.keyboard.press("Escape")
  await expect(first).toHaveCount(0)
  await expect(thread(page, 2)).toBeVisible()
  await page.getByRole("button", { name: /^View options/ }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show resolved comments" }).click()
  await page.keyboard.press("Escape")

  // A collapsed thread expands on click and reopens.
  await first.getByRole("button", { name: /after what it counts/ }).click()
  await first.getByRole("button", { name: "Reopen" }).click()
  await expect(first).toHaveAccessibleName("Thread 1: Open, src/app.ts:1")
  await expect(first.locator(".feedback-message-status").last()).toHaveText("reopened this")

  // Delete removes a thread.
  await thread(page, 2).getByRole("button", { name: "More Thread Actions" }).click()
  await page.getByRole("menuitem", { name: "Delete thread" }).click()
  await expect(thread(page, 2)).toHaveCount(0)

  // Threads persist across a reload.
  await page.reload()
  await expect(thread(page, 1)).toBeVisible({ timeout: 20_000 })

  // A branch review with uncommitted changes shows them, and its Files rail
  // counts each file's open threads.
  await page.goto(`${live.origin}/view?project=${project}&review=branch&uncommitted=1#f=src/app.ts`)
  await expect(thread(page, 1)).toBeVisible({ timeout: 20_000 })
  const railFile = page.getByRole("complementary", { name: "Review files" }).getByRole("treeitem", { name: "app.ts", exact: true })
  await expect(railFile.getByTitle("1 open thread")).toBeAttached()
})

test("a whole file takes a comment from its band", async ({ page, live }) => {
  await page.goto(`${live.origin}/view?project=${encodeURIComponent(live.root)}&review=working#f=README.md`)
  const band = reviewFile(page, "README.md")
  await band.getByRole("button", { name: "Comment on File" }).click()
  const composer = page.getByRole("textbox", { name: "Comment on README.md" })
  await expect(composer).toBeFocused()
  await composer.fill("Split the install section.")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(thread(page, 1)).toHaveAccessibleName("Thread 1: Open, README.md")
})

test("the Feedback view lists, filters, opens, and copies threads", async ({ page, request, live }) => {
  await grantClipboard(page)
  await recordClipboard(page)
  const project = encodeURIComponent(live.root)
  await page.goto(`${live.origin}/view?project=${project}&review=working#f=src/app.ts`)
  await expect(gutter(page, "src/app.ts", "additions", 1)).toBeVisible({ timeout: 20_000 })
  await comment(page, "src/app.ts", 1, "Name the answer after what it counts.")
  await comment(page, "src/app.ts", 4, "Two spaces, as before.")
  const id = await feedbackId(request, live.origin, live.root)

  // Start somewhere without the review, so the agent's reply goes unseen.
  await page.goto(`${live.origin}/?project=${project}`)
  const answered = await request.post(`${live.origin}/api/feedback-messages`, {
    data: { project: live.root, id, thread: 2, body: "Fixed.", status: "resolved", author: "agent" },
  })
  expect(answered.ok()).toBe(true)
  const activity = page.getByRole("button", { name: "Feedback, 1 new reply" })
  await expect(activity).toBeVisible()
  await activity.click()

  const view = page.locator(".feedback-view")
  await expect(view.getByRole("button", { name: /^Branch: / })).toBeVisible()
  await expect(view.getByText(id, { exact: true })).toBeVisible()
  const rows = view.getByRole("listbox", { name: "Threads" }).getByRole("option")
  // Open is the default filter; Resolved lists the agent's resolved thread.
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveAccessibleName(/^Thread 1, Open: Name the answer after what it counts\., src\/app\.ts:1/)
  await view.getByRole("button", { name: "Resolved", exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveAccessibleName(/^Thread 2, Resolved, new reply: Two spaces, as before\./)
  await view.getByRole("button", { name: "All", exact: true }).click()
  await expect(rows).toHaveCount(2)

  // Copy Prompt sends an agent to the CLI; the copy succeeds.
  const copyPrompt = view.getByRole("button", { name: "Copy Prompt" })
  await copyPrompt.click()
  await expect(copyPrompt).toHaveAttribute("data-status", "copied")
  await expect.poll(() => copiedText(page)).toContain(`Read the threads waiting on you: zero feedback show ${id}`)
  expect(await copiedText(page)).toContain(`in ${live.root}.`)

  // Copy as Markdown copies the filtered threads.
  await view.getByRole("button", { name: "More Feedback Actions" }).click()
  await page.getByRole("menuitem", { name: "Copy as Markdown" }).click()
  await expect(view.getByRole("status").filter({ hasText: "Threads copied as Markdown" })).toBeAttached()
  await expect.poll(() => copiedText(page)).toMatch(new RegExp(`^# Feedback ${id}\\n`))
  expect(await copiedText(page)).toContain("## Thread 2 · resolved · src/app.ts:4")

  // A row opens its thread in the review it was written in.
  await rows.first().click()
  await expect(page).toHaveURL(/[?&]review=working.*#f=src\/app\.ts&R1$/)
  await expect(thread(page, 1)).toBeVisible()
  // Expanded, the agent's reply is seen.
  await thread(page, 2).getByRole("button", { name: /Two spaces/ }).click()
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toBeVisible()

  // The fb route reveals the view at that feedback.
  await page.goto(`${live.origin}/view?project=${project}&fb=${id}`)
  await expect(page.getByRole("button", { name: /^Feedback/ })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".feedback-view").getByText(id, { exact: true })).toBeVisible()

  // Delete feedback confirms inline, then empties the view.
  await page.locator(".feedback-view").getByRole("button", { name: "More Feedback Actions" }).click()
  await page.getByRole("menuitem", { name: "Delete feedback" }).click()
  await page.getByRole("group", { name: "Delete feedback" }).getByRole("button", { name: "Delete" }).click()
  await expect(page.locator(".feedback-view")).toContainText("Select lines in a diff or file and press C to comment.")
})
