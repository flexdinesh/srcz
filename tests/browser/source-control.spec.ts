import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, type Page } from "@playwright/test"
import { test } from "./live-test.ts"

import {
  featureSubject, gitFixtureChanges, gitFixtureRoot, lowerBranch, lowerSubject, upperBranch,
} from "./git-fixture.ts"
import { gitApiOrigin } from "./ports.ts"
import { grantClipboard } from "./clipboard.ts"

// The fixture repository is built by the git server's webServer command.
test.skip(() => !existsSync(path.join(gitFixtureRoot, ".git")), "git is not installed")
test.use({ seed: gitFixtureRoot })

const project = encodeURIComponent(gitFixtureRoot)
// Uncommitted changes in review order: folders first, then root files.
const uncommittedFiles = [
  "assets/logo.bin", "guides/start.md", "notes/removed.md", "src/app.ts", "added.md", "large.txt", "README.md", "untracked.txt",
]

type PaneTitle = "Uncommitted" | "Commits" | "Branches"

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sourceControl(page: Page) {
  return page.getByRole("region", { name: "Source Control" })
}

function pane(page: Page, title: PaneTitle) {
  return sourceControl(page).getByRole("region", { name: title, exact: true })
}

function changesList(page: Page) {
  return pane(page, "Uncommitted").getByRole("listbox", { name: "Uncommitted changes" })
}

function changeRow(page: Page, file: string) {
  return changesList(page).getByRole("option", { name: new RegExp(`^${escapeRegExp(file)}, `) })
}

function commitsList(page: Page) {
  return pane(page, "Commits").getByRole("listbox", { name: "Commits" })
}

function commitRow(page: Page, subject: string) {
  return commitsList(page).getByRole("option", { name: new RegExp(`^${escapeRegExp(subject)}, srcz, `) })
}

function branchesList(page: Page) {
  return pane(page, "Branches").getByRole("listbox", { name: "Branches" })
}

function branchRow(page: Page, name: string) {
  return branchesList(page).getByRole("option", { name: new RegExp(`^${escapeRegExp(name)}, `) })
}

// rail is a commit, range, or branch review's Files rail.
function rail(page: Page) {
  return page.getByRole("complementary", { name: "Review files" })
}

function railFile(page: Page, name: string) {
  return rail(page).getByRole("treeitem", { name, exact: true })
}

// filesToggle is the diff toolbar's Files rail toggle.
function filesToggle(page: Page) {
  return page.getByRole("button", { name: "Files", exact: true })
}

function reviewFile(page: Page, file: string) {
  return page.getByRole("main").getByRole("region", { name: file, exact: true })
}

// fileToggle opens or closes a review section's diff.
function fileToggle(page: Page, file: string) {
  return reviewFile(page, file).getByRole("button", { name: new RegExp(`^${file.replaceAll(".", "\\.")}`) })
}

function diffLines(page: Page, type: "change-addition" | "change-deletion", file?: string) {
  const scope = file ? reviewFile(page, file) : page.getByRole("main")
  return scope.locator(`.diff-view [data-line-type="${type}"]`)
}

function commitTab(page: Page, subject: string) {
  return page.getByRole("tab", { name: new RegExp(`^[0-9a-f]{7} ${escapeRegExp(subject)}$`) })
}

async function openReview(page: Page, search: string) {
  await page.goto(`${gitApiOrigin}/view?project=${project}&${search}`)
}

async function openSourceControl(page: Page, which = project) {
  await page.goto(`${gitApiOrigin}/?project=${which}`)
  await page.keyboard.press("ControlOrMeta+Shift+g")
}

// reviewSearch reads the page URL's query but the project, ignoring order.
function reviewSearch(page: Page): Record<string, string> {
  const params = new URL(page.url()).searchParams
  params.delete("project")
  return Object.fromEntries(params)
}

test("Source Control lists every pending change and reviews them in one tab", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/?project=${project}`)
  const activity = page.getByRole("button", { name: `Source Control, ${gitFixtureChanges} pending changes` })
  await expect(activity).toHaveAttribute("aria-pressed", "false")
  await expect(page.locator(".activity-badge")).toHaveText(String(gitFixtureChanges))

  // Explorer rows carry git status; gitignored files are not changes.
  const explorer = page.getByRole("complementary", { name: "Files", exact: true })
  await expect(explorer.locator('[data-item-path="README.md"]')).toHaveAttribute("data-item-git-status", "modified")
  await expect(explorer.locator('[data-item-path="debug.log"]')).not.toHaveAttribute("data-item-git-status", /./)

  await page.keyboard.press("ControlOrMeta+Shift+g")
  await expect(activity).toHaveAttribute("aria-pressed", "true")
  // The Uncommitted pane counts and lists every change by path.
  await expect(pane(page, "Uncommitted").getByLabel(`${gitFixtureChanges} files`, { exact: true })).toHaveText(String(gitFixtureChanges))
  await expect(changesList(page).getByRole("option")).toHaveCount(gitFixtureChanges)
  for (const file of uncommittedFiles) await expect(changeRow(page, file)).toBeVisible()
  await expect(changeRow(page, "debug.log")).toHaveCount(0)
  await expect(changeRow(page, "clean.md")).toHaveCount(0)
  // Rows name their status and carry line stats.
  await expect(changeRow(page, "guides/start.md")).toHaveAccessibleName(/^guides\/start\.md, Renamed(, |$)/)
  await expect(changeRow(page, "untracked.txt")).toHaveAccessibleName(/^untracked\.txt, Untracked(, |$)/)
  await expect(changeRow(page, "README.md")).toHaveAccessibleName("README.md, Modified, +2 −1")

  await changeRow(page, "README.md").click()
  const tab = page.getByRole("tab", { name: "Uncommitted", exact: true })
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]review=working#f=README\.md$/)
  await expect(diffLines(page, "change-addition", "README.md").filter({ hasText: "Four" })).toBeVisible()
  await expect(diffLines(page, "change-deletion", "README.md").filter({ hasText: "Two" })).toBeVisible()
  await expect(page).toHaveTitle(/Uncommitted changes/)
  // One tab reviews every change, under the header every review has.
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Uncommitted", exact: true })).toBeVisible()
  await expect(page.getByRole("main").getByText(`${gitFixtureChanges} files`, { exact: true })).toBeVisible()
  await expect(page.getByRole("main").getByRole("region")).toHaveCount(gitFixtureChanges)
  await expect(page.getByRole("main").getByText(`0 of ${gitFixtureChanges} viewed`)).toBeVisible()
  await expect(changeRow(page, "README.md")).toHaveAttribute("aria-selected", "true")
  // The sidebar lists Uncommitted's files, so its review has no Files rail.
  await expect(rail(page)).toHaveCount(0)
  await expect(filesToggle(page)).toHaveCount(0)

  // Open File opens the document beside the review.
  await reviewFile(page, "README.md").getByRole("button", { name: "Open File" }).click()
  await expect(page.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(tab).toBeVisible()

  // Review tabs survive reloads.
  await tab.click()
  await page.reload()
  await expect(page.getByRole("tab", { name: "Uncommitted", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeVisible()
  await expect(diffLines(page, "change-addition", "README.md").filter({ hasText: "Four" })).toBeVisible()
})

test("large diffs keep the page responsive and render only rows near the viewport @extended", async ({ page }) => {
  test.skip(process.env.SRCZ_BROWSER_EXTENDED !== "1", "requires the full extended git fixture")
  test.setTimeout(60_000)
  await openReview(page, "review=working#f=large.txt")
  // The worker's parse can take seconds on a busy machine.
  await expect(diffLines(page, "change-addition", "large.txt").filter({ hasText: "Line 0: the slow brown fox" })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(".status-diff-stats")).toHaveText("+1,200 −1,200")
  const rows = page.locator(".diff-view [data-line]")
  expect(await rows.count()).toBeLessThan(1_000)

  // Controls remain usable while the worker reparses the diff. Avoid wall-clock
  // thresholds: CPU contention across agent sessions is not a product failure.
  await page.getByRole("button", { name: "View options" }).click()
  const whitespace = page.getByRole("menuitemcheckbox", { name: "Ignore whitespace" })
  const wrap = page.getByRole("menuitemcheckbox", { name: "Wrap lines" })
  await whitespace.click()
  await wrap.click()
  await expect(wrap).toHaveAttribute("aria-checked", "true")
  await expect(whitespace).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")

  // The document pane scrolls the review; rows render where it lands. A
  // wheel turn lets go of the linked file first.
  await page.locator("main").evaluate((pane) => {
    pane.dispatchEvent(new WheelEvent("wheel"))
    pane.scrollTop = pane.scrollHeight
  })
  await expect(diffLines(page, "change-addition", "large.txt").filter({ hasText: "Line 23980: the slow brown fox" })).toBeVisible({ timeout: 10_000 })
  expect(await rows.count()).toBeLessThan(1_000)
})

test("diff line numbers select lines, update the URL, and copy path:line", async ({ page }) => {
  await grantClipboard(page)
  await openReview(page, "review=working#f=README.md")
  // Split: HEAD's lines on the left (L), the working copy's on the right (R).
  const gutter = (side: "deletions" | "additions", line: number) =>
    reviewFile(page, "README.md").locator(`.diff-view [data-${side}] [data-column-number="${line}"]`)
  const status = page.locator(".status-lines")
  // The review keeps README.md in view while large.txt above it loads; a
  // click lets go of it.
  await expect(reviewFile(page, "large.txt").locator(".diff-view")).toBeAttached({ timeout: 20_000 })
  await expect(gutter("additions", 4)).toBeInViewport()
  await expect(status).toHaveCount(0)

  await gutter("additions", 4).click()
  await expect(page).toHaveURL(/#f=README\.md&R4$/)
  await expect(status).toHaveText("Ln 4")
  await expect(page.locator(".status-diff-stats")).toHaveText("+2 −1")
  await page.getByRole("button", { name: "Copy README.md:4" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("README.md:4")

  await gutter("additions", 6).click({ modifiers: ["Shift"] })
  await expect(page).toHaveURL(/#f=README\.md&R4-R6$/)
  await expect(status).toHaveText("Ln 4–6")
  await page.getByRole("button", { name: "Copy README.md:4-6" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("README.md:4-6")

  // HEAD's lines keep HEAD's numbers.
  await gutter("deletions", 4).click()
  await expect(page).toHaveURL(/#f=README\.md&L4$/)
  await expect(status).toHaveText("Old Ln 4")
  await expect(page.getByRole("button", { name: "Copy README.md:4" })).toBeVisible()

  // Escape clears the lines and keeps the file.
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/#f=README\.md$/)
  await expect(status).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Copy README\.md:/ })).toHaveCount(0)

  // A shared range across sides selects the working copy's lines it covers.
  await openReview(page, "review=working#f=README.md&L4-R6")
  await expect(status).toHaveText("Ln 4–6")
  await expect(reviewFile(page, "README.md").locator(".diff-view [data-line][data-selected-line]").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy README.md:4-6" })).toBeVisible()

  // Lines past the end select nothing.
  await openReview(page, "review=working#f=README.md&R40")
  await expect(gutter("additions", 4)).toBeVisible()
  await expect(status).toHaveCount(0)
})

test("review anchors scroll their lines into view and open the unchanged lines they name", async ({ page }) => {
  test.setTimeout(60_000)
  const gutter = (line: number) => reviewFile(page, "large.txt").locator(`.diff-view [data-additions] [data-column-number="${line}"]`)
  const status = page.locator(".status-lines")
  // Fixed lines work in both fixtures; line 301 is a change beyond the
  // initially rendered viewport.
  await openReview(page, "review=working#f=large.txt&R301")
  await expect(gutter(301)).toBeInViewport({ timeout: 20_000 })
  await expect(status).toHaveText("Ln 301")

  // Line 310 sits in the collapsed gap between two changes.
  await openReview(page, "review=working#f=large.txt&R310-R311")
  await expect(gutter(310)).toBeInViewport({ timeout: 20_000 })
  await expect(reviewFile(page, "large.txt").locator(".diff-view [data-line][data-selected-line]").first()).toBeVisible()
  await expect(status).toHaveText("Ln 310–311")

  // Selecting from the gutter leaves the pane where it is.
  const pane = page.locator("main")
  const before = await pane.evaluate((element) => element.scrollTop)
  await gutter(312).click()
  await expect(page).toHaveURL(/#f=large\.txt&R312$/)
  await expect(status).toHaveText("Ln 312")
  expect(await pane.evaluate((element) => element.scrollTop)).toBe(before)
})

test("F7 and the toolbar step through changes across the review's files", async ({ page }) => {
  test.setTimeout(60_000)
  const gutter = (line: number) => reviewFile(page, "large.txt").locator(`.diff-view [data-additions] [data-column-number="${line}"]`)
  await openReview(page, "review=working#f=large.txt")
  await expect(gutter(1)).toBeVisible({ timeout: 20_000 })
  const pane = page.locator("main")
  await pane.focus()

  // Each hunk is its change with four lines of context either side.
  await page.keyboard.press("F7")
  await expect(page).toHaveURL(/#f=large\.txt&R1-R5$/)
  await page.keyboard.press("F7")
  await expect(page).toHaveURL(/#f=large\.txt&R17-R25$/)
  await expect(page.getByRole("button", { name: "Copy large.txt:17-25" })).toBeVisible()
  await page.keyboard.press("Shift+F7")
  await expect(page).toHaveURL(/#f=large\.txt&R1-R5$/)

  // Past a file's first change, steps cross into the file before it.
  await page.keyboard.press("Shift+F7")
  await expect(page).toHaveURL(/#f=added\.md&R1-R3$/)
  await expect(reviewFile(page, "added.md").locator(".diff-view [data-line][data-selected-line]").first()).toBeInViewport()
  await page.getByRole("button", { name: "Previous change" }).click()
  await expect(page).toHaveURL(/#f=src\/app\.ts&R1-R5$/)
  await page.getByRole("button", { name: "Next change" }).click()
  await expect(page).toHaveURL(/#f=added\.md&R1-R3$/)
  await page.getByRole("button", { name: "Next change" }).click()
  await expect(page).toHaveURL(/#f=large\.txt&R1-R5$/)
  await expect(gutter(1)).toBeInViewport()

  // Files without hunks are skipped, and steps wrap past the review's ends.
  await openReview(page, "review=working#f=notes/removed.md")
  await expect(diffLines(page, "change-deletion", "notes/removed.md").first()).toBeVisible()
  await pane.focus()
  await page.keyboard.press("F7")
  await expect(page).toHaveURL(/#f=notes\/removed\.md&L1-L3$/)
  await page.keyboard.press("Shift+F7")
  await expect(page).toHaveURL(/#f=untracked\.txt&R1$/)
  await expect(reviewFile(page, "untracked.txt").locator(".diff-view [data-line][data-selected-line]").first()).toBeInViewport()
})

test("a review's scrollbar runs only its pane's height, in a lane on the review's surface", async ({ page }) => {
  await openReview(page, "review=branch#f=clean.md")
  await expect(rail(page)).toBeVisible()
  const main = page.locator("#document-pane")
  const review = main.locator(".review")
  const background = (element: Element) => getComputedStyle(element).backgroundColor
  // The gutter main reserves paints as part of the review, and the file bands
  // end on the lane's hairline.
  expect(await main.evaluate(background)).toBe(await review.evaluate(background))
  expect(await review.evaluate((element) => getComputedStyle(element).borderRightWidth)).toBe("1px")
  const [mainBox, reviewBox, railBox, toolbarBox] = await Promise.all([
    main.boundingBox(), review.boundingBox(), rail(page).boundingBox(), page.locator(".workspace-toolbar").boundingBox(),
  ])
  if (!mainBox || !reviewBox || !railBox || !toolbarBox) throw new Error("review panes are not laid out")
  // Playwright's WebKit reserves no gutter, so the review may reach the edge.
  expect(reviewBox.x + reviewBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width)
  expect(mainBox.y).toBe(toolbarBox.y + toolbarBox.height)
  expect(railBox.y).toBe(mainBox.y)
  expect(railBox.y + railBox.height).toBe(mainBox.y + mainBox.height)
})

test("every corner is square, inside Pierre's trees and diffs and on overlays", async ({ page }) => {
  // roundedElements walks the page and its shadow roots for any curved corner.
  const roundedElements = () => {
    const rounded: string[] = []
    const walk = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll("*")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const style = getComputedStyle(element, pseudo)
          const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
          const curved = corners.find((value) => value !== "" && value !== "0px")
          if (curved) rounded.push(`${element.tagName}.${element.getAttribute("class") ?? ""}${pseudo ?? ""}: ${curved}`)
        }
        if (element.shadowRoot) walk(element.shadowRoot)
      }
    }
    walk(document)
    return rounded
  }

  await openReview(page, "review=branch#f=clean.md")
  await expect(rail(page)).toBeVisible()
  await expect(reviewFile(page, "clean.md").locator(".diff-view")).toBeVisible()
  expect(await page.evaluate(roundedElements)).toEqual([])

  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible()
  expect(await page.evaluate(roundedElements)).toEqual([])
  await page.keyboard.press("Escape")

  await page.keyboard.press("ControlOrMeta+Shift+P")
  await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible()
  expect(await page.evaluate(roundedElements)).toEqual([])
})

test("phones stack the panes, open diffs from a tapped commit, and force Unified", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${gitApiOrigin}/?project=${project}`)
  await page.getByRole("button", { name: "Open files" }).click()
  await page.getByRole("button", { name: /^Source Control, / }).click()
  const drawer = page.getByRole("dialog", { name: "Source Control" })
  // Phones stack the panes and scroll; nothing splits their height.
  for (const title of ["Uncommitted", "Commits", "Branches"]) {
    await expect(drawer.getByRole("region", { name: title, exact: true })).toBeVisible()
  }
  await expect(drawer.getByRole("separator")).toHaveCount(0)
  const commits = drawer.getByRole("listbox", { name: "Commits" })
  await expect(commits).not.toHaveAttribute("aria-multiselectable", "true")

  // A tap selects a commit and opens its diff, closing the drawer.
  const commit = commits.getByRole("option", { name: new RegExp(`^${featureSubject}, `) })
  await commit.click()
  await expect(drawer).toBeHidden()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  // Phones keep the rail in a sheet the toolbar opens.
  await expect(rail(page)).toHaveCount(0)
  await filesToggle(page).click()
  const sheet = page.getByRole("dialog", { name: "Review files" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole("treeitem", { name: "history.md", exact: true })).toBeVisible()
  await sheet.getByRole("treeitem", { name: "clean.md", exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/#f=clean\.md$/)
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeInViewport()

  await page.getByRole("button", { name: "Open files" }).click()
  await page.getByRole("button", { name: /^Source Control, / }).click()
  await expect(drawer).toBeVisible()
  await drawer.getByRole("listbox", { name: "Uncommitted changes" }).getByRole("option", { name: /^src\/app\.ts, / }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole("tab", { name: "Uncommitted", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/#f=src\/app\.ts$/)
  await expect(reviewFile(page, "src/app.ts").locator(".diff-view pre[data-diff-type]")).toHaveAttribute("data-diff-type", "single")
  // Phones give the layout group's room to tabs; tablets explain it.
  await expect(page.getByRole("button", { name: "Split" })).toBeHidden()
  await page.setViewportSize({ width: 700, height: 844 })
  await expect(page.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Split" })).toHaveAttribute("aria-disabled", "true")
})

test("Split follows the diff area's width, not just the window's", async ({ page }) => {
  await openReview(page, "review=branch#f=clean.md")
  await expect(rail(page)).toBeVisible()
  await rail(page).getByRole("button", { name: "Hide Files" }).click()
  await expect(rail(page)).toHaveCount(0)
  // Size the window so the diff area is just over 48rem without the rail.
  const main = page.getByRole("main")
  const viewport = page.viewportSize()
  const width = (await main.boundingBox())?.width ?? 0
  await page.setViewportSize({ width: Math.round((viewport?.width ?? 0) - width + 16 * 52), height: viewport?.height ?? 720 })
  const split = page.getByRole("button", { name: "Split" })
  const pre = reviewFile(page, "clean.md").locator(".diff-view pre[data-diff-type]")
  await expect(split).not.toHaveAttribute("aria-disabled", "true")
  await expect(split).toHaveAttribute("aria-pressed", "true")
  await expect(pre).toHaveAttribute("data-diff-type", "split")

  // The rail narrows the diff area below 48rem, which forces Unified.
  await filesToggle(page).click()
  await expect(rail(page)).toBeVisible()
  await expect(split).toHaveAttribute("aria-disabled", "true")
  await expect(page.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true")
  await expect(pre).toHaveAttribute("data-diff-type", "single")
})

test("status failures keep the view usable and recover on Retry", async ({ page }) => {
  let fail = true
  await page.route("**/api/changes?*", async (route) => {
    if (!fail) return route.continue()
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't read git status: index is corrupt" }) })
  })
  await openSourceControl(page)
  await expect(pane(page, "Uncommitted").getByRole("alert")).toContainText("Couldn't read git status: index is corrupt.")
  await expect(page.locator(".activity-badge")).toHaveCount(0)
  // History and the stack still list.
  await expect(commitRow(page, featureSubject)).toBeVisible()
  await expect(branchRow(page, "feature")).toBeVisible()
  fail = false
  await pane(page, "Uncommitted").getByRole("button", { name: "Retry" }).click()
  await expect(changeRow(page, "README.md")).toBeVisible()
  await expect(page.locator(".activity-badge")).toHaveText(String(gitFixtureChanges))
})

test("clicking a commit opens the commit's review with a Files rail, keeping focus in the list", async ({ page }) => {
  await openSourceControl(page)
  await expect(pane(page, "Commits").getByText("2 ahead of main")).toBeVisible()
  await expect(pane(page, "Commits").getByRole("button", { name: "Branch", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(commitsList(page).getByRole("option")).toHaveCount(2)

  const commit = commitRow(page, featureSubject)
  const lower = commitRow(page, lowerSubject)
  const glyph = (row: typeof commit) => row.locator(".commit-diff-glyph")
  await page.mouse.move(0, 0)
  // Rows carry no Diff button; a glyph shows on hover that a click opens the diff.
  await expect(commitsList(page).getByRole("button", { name: /^Open changes/ })).toHaveCount(0)
  await expect(glyph(commit)).toBeHidden()
  await commit.hover()
  await expect(glyph(commit)).toBeVisible()
  await expect(commit.locator(".compare-row-age")).toBeHidden()
  // A click selects the commit and opens its diff; focus stays on the row.
  await commit.click()
  await expect(commit).toHaveAttribute("aria-selected", "true")
  await expect(lower).toHaveAttribute("aria-selected", "false")
  await expect(commit).toBeFocused()
  // The selection keeps its glyph.
  await lower.hover()
  await expect(glyph(commit)).toBeVisible()

  const tab = commitTab(page, featureSubject)
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}$/)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: featureSubject })).toBeVisible()
  await expect(main).toContainText("Explain how the fixture's branch history is built.")
  await expect(main.locator(".review-meta")).toContainText("srcz")

  // The rail lists the commit's files with line stats.
  await expect(rail(page).getByRole("heading", { name: "Files" })).toBeVisible()
  await expect(rail(page).getByLabel("2 files", { exact: true })).toHaveText("2")
  await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true")
  await expect(railFile(page, "clean.md")).toContainText("+2 −0")
  await expect(railFile(page, "history.md")).toContainText("+3 −0")
  // The first file is in view, so it is selected.
  await expect(railFile(page, "history.md")).toHaveAttribute("aria-selected", "true")
  // Folders collapse one at a time too.
  await railFile(page, "docs").click()
  await expect(railFile(page, "history.md")).toHaveCount(0)
  await railFile(page, "docs").click()

  await railFile(page, "clean.md").click()
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}#f=clean\.md$/)
  await expect(railFile(page, "clean.md")).toHaveAttribute("aria-selected", "true")
  await railFile(page, "history.md").click()
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}#f=docs\/history\.md$/)
  await expect(diffLines(page, "change-addition", "docs/history.md").filter({ hasText: "Written on the feature branch." })).toBeVisible()
  await expect(page.locator(".status-diff-stats")).toHaveText("+3 −0")
  await expect(railFile(page, "history.md")).toHaveAttribute("aria-selected", "true")

  // A commit compares with its parent, not the working tree.
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeVisible()

  // Commit tabs survive reloads; Open File opens the working copy.
  await page.reload()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  await expect(diffLines(page, "change-addition", "docs/history.md").filter({ hasText: "Written on the feature branch." })).toBeVisible()
  await reviewFile(page, "docs/history.md").getByRole("button", { name: "Open File" }).click()
  await expect(page.getByRole("tab", { name: "history.md", exact: true })).toHaveAttribute("aria-selected", "true")
})

test("a review tab keeps its scroll, files, and rail behind a document tab, without rereading diffs", async ({ page }) => {
  await openSourceControl(page)
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  await commitRow(page, "Initial").click()
  await fileToggle(page, "assets/logo.bin").click()
  await expect(fileToggle(page, "assets/logo.bin")).toHaveAttribute("aria-expanded", "false")
  await railFile(page, "app.ts").click()
  await expect(page).toHaveURL(/#f=src\/app\.ts$/)
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  await expect(fileToggle(page, "src/app.ts")).toBeInViewport()
  // Scrolling releases the pin; the review is left mid-file.
  const main = page.locator("main")
  const top = await main.evaluate((pane) => {
    pane.dispatchEvent(new WheelEvent("wheel"))
    pane.scrollTop += 24
    return pane.scrollTop
  })
  await expect(railFile(page, "app.ts")).toHaveAttribute("aria-selected", "true")

  const diffReads: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/diff") diffReads.push(request.url())
  })
  await reviewFile(page, "src/app.ts").getByRole("button", { name: "Open File" }).click()
  await expect(page.getByRole("tab", { name: "app.ts" })).toHaveAttribute("aria-selected", "true")
  await expect(rail(page)).toBeHidden()

  await commitTab(page, "Initial").click()
  await expect(commitTab(page, "Initial")).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/#f=src\/app\.ts$/)
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  await expect.poll(() => main.evaluate((pane) => pane.scrollTop)).toBeCloseTo(top, 0)
  await expect(fileToggle(page, "assets/logo.bin")).toHaveAttribute("aria-expanded", "false")
  await expect(railFile(page, "app.ts")).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".status-path")).toHaveText("src/app.ts")
  expect(diffReads).toEqual([])
})

test("a review leaves scroll anchoring to its diff virtualizer, and documents get it back", async ({ page }) => {
  await openReview(page, "review=working")
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  const anchoring = () => page.locator("main").evaluate((pane) => getComputedStyle(pane).overflowAnchor)
  await expect.poll(anchoring).toBe("none")

  await reviewFile(page, "src/app.ts").getByRole("button", { name: "Open File" }).click()
  await expect(page.getByRole("tab", { name: "app.ts" })).toHaveAttribute("aria-selected", "true")
  await expect.poll(anchoring).toBe("auto")

  await page.goBack()
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  await expect.poll(anchoring).toBe("none")
})

// Two anchoring authorities (the browser's and the virtualizer's) disagree in
// WebKit: one shifts the pane mid-scroll and the other scrolls it back, which
// a trackpad's momentum shows as jitter (decision 0111).
test("scrolling down a review never scrolls the pane back up", async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const scrollTo = Element.prototype.scrollTo
    let back = 0
    Element.prototype.scrollTo = function (this: Element, first?: ScrollToOptions | number, second?: number) {
      const top = typeof first === "number" ? second : first?.top
      if (this.tagName === "MAIN" && top !== undefined && top < this.scrollTop - 1) {
        back += 1
        document.documentElement.dataset.paneScrolledBack = String(back)
      }
      Reflect.apply(scrollTo, this, typeof first === "number" ? [first, second ?? 0] : [first])
    }
  })
  await openReview(page, "review=working")
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  const main = page.locator("main")
  const box = await main.boundingBox()
  if (!box) throw new Error("the review pane is not laid out")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let step = 0; step < 80; step += 1) {
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(40)
  }
  expect(await page.evaluate(() => document.documentElement.dataset.paneScrolledBack ?? "0")).toBe("0")
  // The wheel crossed several viewports, through sections that load as they near.
  expect(await main.evaluate((pane) => pane.scrollTop / pane.clientHeight)).toBeGreaterThan(2)
})

test("a pinned review file stays the file in view behind a document tab", async ({ page }) => {
  await openSourceControl(page)
  const current = branchRow(page, "feature")
  await current.hover()
  await current.getByRole("button", { name: "Open changes on feature since main" }).click()
  const tab = page.getByRole("tab", { name: "vs main", exact: true })
  // clean.md is last, too near the end to reach the top.
  await railFile(page, "clean.md").click()
  await expect(page).toHaveURL(/#f=clean\.md$/)
  await expect(railFile(page, "clean.md")).toHaveAttribute("aria-selected", "true")
  await reviewFile(page, "clean.md").getByRole("button", { name: "Open File" }).click()
  await expect(page.getByRole("tab", { name: "clean.md" })).toHaveAttribute("aria-selected", "true")

  await page.goBack()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/#f=clean\.md$/)
  await expect(railFile(page, "clean.md")).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".status-path")).toHaveText("clean.md")
})

test("a layer opens its own commits or everything since the base", async ({ page }) => {
  await openSourceControl(page)
  const upper = branchRow(page, upperBranch)
  const lower = branchRow(page, lowerBranch)
  // The lowest layer's own commits are its base diff, so it offers only that.
  await lower.hover()
  await expect(lower.getByRole("button", { name: `Open changes on ${lowerBranch} since main` })).toBeVisible()
  await expect(lower.getByRole("button", { name: /since (?!main)/ })).toHaveCount(0)

  // A layer above HEAD against the layer below.
  await upper.hover()
  await upper.getByRole("button", { name: `Open changes on ${upperBranch} since feature` }).click()
  await expect(page.getByRole("tab", { name: `${upperBranch} vs feature`, exact: true })).toHaveAttribute("aria-selected", "true")
  expect(reviewSearch(page)).toEqual({ review: "branch", base: "feature", head: upperBranch })
  await expect(page.getByRole("main").getByText(`1 commit on ${upperBranch} ahead of feature`)).toBeVisible()
  await expect(rail(page).getByLabel("1 file", { exact: true })).toBeVisible()
  await expect(railFile(page, "changelog.md")).toBeVisible()
  await expect(railFile(page, "history.md")).toHaveCount(0)
  await expect(diffLines(page, "change-addition", "docs/changelog.md").filter({ hasText: "Written on the upper layer." })).toBeVisible()

  // The same layer against the base.
  await upper.hover()
  await upper.getByRole("button", { name: `Open changes on ${upperBranch} since main` }).click()
  await expect(page.getByRole("tab", { name: `${upperBranch} vs main`, exact: true })).toHaveAttribute("aria-selected", "true")
  expect(reviewSearch(page)).toEqual({ review: "branch", head: upperBranch })
  await expect(page.getByRole("main").getByText(`3 commits on ${upperBranch} ahead of main`)).toBeVisible()
  await expect(rail(page).getByLabel("4 files", { exact: true })).toBeVisible()
  await expect(railFile(page, "changelog.md")).toBeVisible()
  await expect(railFile(page, "index.md")).toBeVisible()
  await expect(railFile(page, "history.md")).toBeVisible()
  await expect(railFile(page, "clean.md")).toBeVisible()

  // HEAD's layer against the layer below compares HEAD.
  const current = branchRow(page, "feature")
  await current.hover()
  await current.getByRole("button", { name: `Open changes on feature since ${lowerBranch}` }).click()
  await expect(page.getByRole("tab", { name: `vs ${lowerBranch}`, exact: true })).toHaveAttribute("aria-selected", "true")
  expect(reviewSearch(page)).toEqual({ review: "branch", base: lowerBranch })
  await expect(rail(page).getByLabel("2 files", { exact: true })).toBeVisible()
  await expect(railFile(page, "history.md")).toBeVisible()
  await expect(railFile(page, "clean.md")).toBeVisible()
  await expect(railFile(page, "index.md")).toHaveCount(0)

  // HEAD's layer against the base is the branch review as before.
  await current.hover()
  await current.getByRole("button", { name: "Open changes on feature since main" }).click()
  await expect(page.getByRole("tab", { name: "vs main", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(reviewSearch(page)).toEqual({ review: "branch" })
  await expect(page.getByRole("main").getByText("2 commits ahead of main")).toBeVisible()
  await expect(rail(page).getByLabel("3 files", { exact: true })).toBeVisible()
  await expect(railFile(page, "index.md")).toBeVisible()
  await expect(railFile(page, "changelog.md")).toHaveCount(0)

  // Double-click opens a layer's base diff.
  await lower.dblclick()
  await expect(page.getByRole("tab", { name: `${lowerBranch} vs main`, exact: true })).toHaveAttribute("aria-selected", "true")
  expect(reviewSearch(page)).toEqual({ review: "branch", head: lowerBranch })
  await expect(rail(page).getByLabel("1 file", { exact: true })).toBeVisible()
  await expect(railFile(page, "index.md")).toBeVisible()
  await expect(page.getByRole("main")).toBeFocused()

  // Layer reviews survive reloads.
  await page.reload()
  await expect(page.getByRole("tab", { name: `${lowerBranch} vs main`, exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(diffLines(page, "change-addition", "docs/index.md").filter({ hasText: "Written on the lower layer." })).toBeVisible()
})

test("HEAD's branch review adds uncommitted changes in place and marks their files", async ({ page }) => {
  await openReview(page, "review=branch#f=clean.md")
  const branchTab = page.getByRole("tab", { name: "vs main", exact: true })
  await expect(branchTab).toHaveAttribute("aria-selected", "true")
  const scope = page.getByRole("main").getByRole("group", { name: "Changes to include" })
  const committed = scope.getByRole("button", { name: "Committed", exact: true })
  const uncommitted = scope.getByRole("button", { name: `Include uncommitted changes, ${gitFixtureChanges} files` })
  await expect(committed).toHaveAttribute("aria-pressed", "true")
  await expect(uncommitted).toHaveAttribute("aria-pressed", "false")
  await expect(reviewFile(page, "docs/history.md")).toBeVisible()
  await expect(reviewFile(page, "README.md")).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("img", { name: "Has uncommitted changes" })).toHaveCount(0)

  // The tab switches in place and keeps the file in view.
  await uncommitted.click()
  const combinedTab = page.getByRole("tab", { name: "vs main + uncommitted", exact: true })
  await expect(combinedTab).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab")).toHaveCount(1)
  expect(reviewSearch(page)).toEqual({ review: "branch", uncommitted: "1" })
  await expect(page).toHaveURL(/#f=clean\.md$/)
  await expect(uncommitted).toHaveAttribute("aria-pressed", "true")

  // Committed and uncommitted changes read from the merge base to the
  // working tree; only files with uncommitted edits carry the dot.
  await expect(reviewFile(page, "docs/history.md")).toBeVisible()
  await expect(reviewFile(page, "docs/index.md")).toBeVisible()
  await expect(reviewFile(page, "untracked.txt")).toBeVisible()
  await expect(reviewFile(page, "README.md").getByRole("img", { name: "Has uncommitted changes" })).toBeVisible()
  await expect(reviewFile(page, "clean.md").getByRole("img", { name: "Has uncommitted changes" })).toHaveCount(0)
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeVisible()
  await expect(rail(page).locator('[data-item-path="README.md"] [title^="Has uncommitted changes"]')).toBeVisible()
  await expect(rail(page).locator('[data-item-path="clean.md"] [title^="Has uncommitted changes"]')).toHaveCount(0)
  await reviewFile(page, "README.md").scrollIntoViewIfNeeded()
  await expect(diffLines(page, "change-addition", "README.md").filter({ hasText: "Two, changed" })).toBeVisible()

  // The scope survives a reload, and switching back restores the tab.
  await page.reload()
  await expect(combinedTab).toHaveAttribute("aria-selected", "true")
  await committed.click()
  await expect(branchTab).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab")).toHaveCount(1)
  expect(reviewSearch(page)).toEqual({ review: "branch" })
  await expect(reviewFile(page, "README.md")).toHaveCount(0)
})

test("the base picker changes the stack's base and is remembered", async ({ page }) => {
  await openSourceControl(page)
  const branches = pane(page, "Branches")
  await expect(branches.getByText("base main", { exact: true })).toBeVisible()
  await branches.getByRole("button", { name: "Change base branch" }).click()
  const filter = page.getByRole("combobox", { name: "Filter branches" })
  await expect(filter).toBeFocused()
  const choices = page.getByRole("dialog", { name: "Base branch" }).getByRole("listbox", { name: "Branches" })
  await expect(choices.getByRole("option", { name: /^Default/ })).toHaveAttribute("aria-selected", "true")
  await filter.fill("rel")
  await expect(choices.getByRole("option")).toHaveCount(1)
  await choices.getByRole("option", { name: "release" }).click()
  await expect(choices).toBeHidden()

  await expect(branches.getByText("base release", { exact: true })).toBeVisible()
  await expect(branchRow(page, lowerBranch)).toHaveAccessibleName(`${lowerBranch}, 1 commit on release`)
  await expect(pane(page, "Commits").getByText("2 ahead of release")).toBeVisible()
  const current = branchRow(page, "feature")
  await current.hover()
  await current.getByRole("button", { name: "Open changes on feature since release" }).click()
  expect(reviewSearch(page)).toEqual({ review: "branch", base: "release" })
  await expect(page.getByRole("tab", { name: "vs release", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("main").getByText("2 commits ahead of release")).toBeVisible()
  await expect(railFile(page, "history.md")).toBeVisible()
  // A layer's diff keeps the chosen base.
  const lower = branchRow(page, lowerBranch)
  await lower.hover()
  await lower.getByRole("button", { name: `Open changes on ${lowerBranch} since release` }).click()
  expect(reviewSearch(page)).toEqual({ review: "branch", base: "release", head: lowerBranch })
  await expect(page.getByRole("tab", { name: `${lowerBranch} vs release`, exact: true })).toHaveAttribute("aria-selected", "true")

  // The choice is remembered for the project.
  await page.reload()
  await expect(branches.getByText("base release", { exact: true })).toBeVisible()
  await branches.getByRole("button", { name: "Change base branch" }).click()
  await expect(choices.getByRole("option", { name: "release" })).toHaveAttribute("aria-selected", "true")
})

test("Shift-clicking commits opens their range's diff", async ({ page }) => {
  await openSourceControl(page)
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  const feature = commitRow(page, featureSubject)
  const lower = commitRow(page, lowerSubject)
  const initial = commitRow(page, "Initial")
  const glyph = (row: typeof feature) => row.locator(".commit-diff-glyph")
  await expect(initial).toBeVisible()
  await expect(commitsList(page)).toHaveAttribute("aria-multiselectable", "true")

  await feature.click()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  await initial.click({ modifiers: ["Shift"] })
  for (const row of [feature, lower, initial]) await expect(row).toHaveAttribute("aria-selected", "true")
  // Only the newest selected commit carries the range's glyph.
  await lower.hover()
  await expect(glyph(lower)).toHaveCount(0)
  await expect(glyph(initial)).toHaveCount(0)
  await expect(glyph(feature)).toBeVisible()

  const tab = page.getByRole("tab", { name: /^[0-9a-f]{7}\.\.[0-9a-f]{7}$/ })
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]from=[0-9a-f]{40}&to=[0-9a-f]{40}$/)
  await expect(page.getByRole("main").getByText(/^3 commits$/)).toBeVisible()
  // The oldest selected commit is the root, so every file is added.
  await expect(railFile(page, "history.md")).toBeVisible()
  await expect(railFile(page, "index.md")).toBeVisible()
  await expect(rail(page).locator('[data-item-path="clean.md"]')).toHaveAttribute("data-item-git-status", "added")
  await railFile(page, "clean.md").click()
  await expect(page).toHaveURL(/[?&]from=[0-9a-f]{40}&to=[0-9a-f]{40}#f=clean\.md$/)
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeVisible()

  // Escape narrows to the commit the range started from; the tab stays open.
  await feature.focus()
  await page.keyboard.press("Escape")
  await expect(feature).toHaveAttribute("aria-selected", "true")
  await expect(lower).toHaveAttribute("aria-selected", "false")
  await expect(initial).toHaveAttribute("aria-selected", "false")
  await expect(glyph(feature)).toBeVisible()
  await expect(tab).toBeVisible()

  // Shift+Arrow extends from the focused commit; Escape narrows it again.
  await page.keyboard.press("Shift+ArrowDown")
  await expect(lower).toBeFocused()
  await expect(lower).toHaveAttribute("aria-selected", "true")
  await expect(feature).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expect(lower).toHaveAttribute("aria-selected", "false")
  await expect(feature).toHaveAttribute("aria-selected", "true")

  // Switching the list to the branch narrows a range to its newest commit.
  await initial.click({ modifiers: ["Shift"] })
  await expect(initial).toHaveAttribute("aria-selected", "true")
  await pane(page, "Commits").getByRole("button", { name: "Branch", exact: true }).click()
  await expect(initial).toHaveCount(0)
  await expect(feature).toHaveAttribute("aria-selected", "true")
  await expect(lower).toHaveAttribute("aria-selected", "false")

  await page.reload()
  await expect(page.getByRole("tab", { name: /^[0-9a-f]{7}\.\.[0-9a-f]{7}$/ })).toHaveAttribute("aria-selected", "true")
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeVisible()
})

test("arrows select commits without opening them; Enter opens and focuses the diff", async ({ page }) => {
  await openSourceControl(page)
  const feature = commitRow(page, featureSubject)
  const lower = commitRow(page, lowerSubject)
  await feature.focus()
  await page.keyboard.press("ArrowDown")
  await expect(lower).toBeFocused()
  await expect(lower).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab")).toHaveText(["Welcome"])
  await expect(page).not.toHaveURL(/[?&]commit=/)

  await page.keyboard.press("Enter")
  await expect(commitTab(page, lowerSubject)).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("main")).toBeFocused()
})

test("a commit's details list its files, which open its review at that file", async ({ page }) => {
  await openSourceControl(page)
  const commit = commitRow(page, featureSubject)
  const details = commitsList(page).locator(".commit-details")
  await commit.getByRole("button", { name: "Show commit details" }).click()
  // Files list in review order and open nothing until clicked.
  const files = details.locator(".commit-details-file")
  await expect(files).toHaveCount(2)
  await expect(files.nth(0).locator(".changes-row-name")).toHaveText("history.md")
  await expect(files.nth(0).locator(".changes-row-folder")).toHaveText("docs")
  await expect(files.nth(1).locator(".changes-row-name")).toHaveText("clean.md")
  await expect(files.nth(1).locator(".commit-file-status")).toHaveText("M")
  await expect(page.getByRole("tab")).toHaveText(["Welcome"])
  await files.filter({ hasText: "clean.md" }).click()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}#f=clean\.md$/)
  await expect(diffLines(page, "change-addition", "clean.md").filter({ hasText: "Edited on the feature branch." })).toBeVisible()
})

test("a big commit's details list its first 20 files, then a row that opens the review", async ({ page }) => {
  await page.route("**/api/commit-files?*", async (route) => {
    const response = await route.fetch()
    const body: unknown = await response.json()
    if (typeof body !== "object" || body === null || !("files" in body)) throw new Error("unexpected commit files response")
    const files = Array.from({ length: 25 }, (_, index) => ({ path: `many/file-${String(index).padStart(2, "0")}.md`, status: "added" }))
    await route.fulfill({ response, json: { ...body, files } })
  })
  await openSourceControl(page)
  const commit = commitRow(page, featureSubject)
  await commit.getByRole("button", { name: "Show commit details" }).click()
  const details = commitsList(page).locator(".commit-details")
  await expect(details.locator(".commit-details-file:not(.commit-details-more)")).toHaveCount(20)
  const more = details.locator(".commit-details-more")
  await expect(more).toHaveText("5 more files")
  await more.click()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}$/)
})

test("commit pagination recovers on Retry", async ({ page }) => {
  let failMore = true
  await page.route("**/api/commits?*", async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get("range") !== "all") return route.continue()
    if (params.has("skip")) {
      if (!failMore) return route.continue()
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't read git history: object missing" }) })
    }
    // The first page holds only the newest commit.
    const response = await route.fetch()
    const body: unknown = await response.json()
    if (typeof body !== "object" || body === null || !("commits" in body) || !Array.isArray(body.commits)) throw new Error("unexpected commits response")
    await route.fulfill({ response, json: { ...body, commits: body.commits.slice(0, 1), more: true, next: 1 } })
  })
  await openSourceControl(page)
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  const more = pane(page, "Commits").getByRole("button", { name: "Load more" })
  await expect(more).toBeVisible()
  await expect(commitsList(page).getByRole("option")).toHaveCount(1)

  await more.click()
  await expect(pane(page, "Commits").getByRole("alert")).toContainText("object missing")
  failMore = false
  await pane(page, "Commits").getByRole("button", { name: "Retry" }).click()
  await expect(commitRow(page, "Initial")).toBeVisible()
  await expect(pane(page, "Commits").getByRole("button", { name: /^(Load more|Retry)$/ })).toHaveCount(0)
})

test("a failed switch to all history never lists the branch as all history", async ({ page }) => {
  let fail = true
  await page.route("**/api/commits?*", async (route) => {
    if (!fail || new URL(route.request().url()).searchParams.get("range") !== "all") return route.continue()
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't read git history: object missing" }) })
  })
  await openSourceControl(page)
  await expect(commitRow(page, featureSubject)).toBeVisible()
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  await expect(pane(page, "Commits").getByRole("alert")).toHaveText("Couldn't read git history: object missing.")
  await expect(commitsList(page).getByRole("option")).toHaveCount(0)
  fail = false
  await pane(page, "Commits").getByRole("button", { name: "Retry" }).click()
  await expect(commitRow(page, "Initial")).toBeVisible()
  await expect(commitsList(page).getByRole("option")).toHaveCount(3)
})

test("Viewed marks collapse files, survive reloads, and read changed since viewed when the file changes", async ({ page, live }) => {
  const file = path.join(live.root, "untracked.txt")
  const original = readFileSync(file, "utf8")
  try {
    await page.goto(`${live.origin}/view?project=${encodeURIComponent(live.root)}&review=working#f=untracked.txt`)
    const viewed = reviewFile(page, "untracked.txt").getByRole("button", { name: "Viewed" })
    // Marks wait for the file's content hash.
    await expect(viewed).toBeEnabled()
    await expect(viewed).toHaveAttribute("aria-pressed", "false")
    await viewed.click()
    await expect(viewed).toHaveAttribute("aria-pressed", "true")
    await expect(fileToggle(page, "untracked.txt")).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("main").getByText(`1 of ${gitFixtureChanges} viewed`)).toBeVisible()

    await page.reload()
    await expect(viewed).toHaveAttribute("aria-pressed", "true")
    await expect(fileToggle(page, "untracked.txt")).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("main").getByText(`1 of ${gitFixtureChanges} viewed`)).toBeVisible()

    // New content is a new blob: the mark no longer counts, and the file
    // opens again saying it changed since it was viewed, without a reload.
    const changed = reviewFile(page, "untracked.txt").getByText("Changed since viewed")
    await expect(changed).toHaveCount(0)
    writeFileSync(file, `${original}Edited after review.\n`)
    await expect(reviewFile(page, "untracked.txt")).toContainText("+2 −0")
    await expect(viewed).toHaveAttribute("aria-pressed", "false")
    await expect(changed).toBeVisible()
    await expect(fileToggle(page, "untracked.txt")).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("main").getByText(`0 of ${gitFixtureChanges} viewed`)).toBeVisible()
    await page.reload()
    await expect(changed).toBeVisible()
    await expect(fileToggle(page, "untracked.txt")).toHaveAttribute("aria-expanded", "true")
    // Marking it again takes the new content.
    await viewed.click()
    await expect(viewed).toHaveAttribute("aria-pressed", "true")
    await expect(changed).toHaveCount(0)
  } finally {
    writeFileSync(file, original)
  }
})

test("the Uncommitted list, its review, and its tree share one order, and pure renames read renamed", async ({ page }) => {
  await openSourceControl(page)
  const rows = changesList(page).getByRole("option")
  await expect(rows).toHaveCount(gitFixtureChanges)
  expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-path")))).toEqual(uncommittedFiles)
  // A rename without line changes says so instead of +0 −0.
  await expect(changeRow(page, "guides/start.md")).toHaveAccessibleName("guides/start.md, Renamed")
  await expect(changeRow(page, "guides/start.md").locator(".changes-row-stats")).toHaveText("renamed")

  await changeRow(page, "README.md").click()
  const sections = page.getByRole("main").locator("[data-review-path]")
  await expect(sections).toHaveCount(gitFixtureChanges)
  expect(await sections.evaluateAll((items) => items.map((item) => item.getAttribute("data-review-path")))).toEqual(uncommittedFiles)

  await pane(page, "Uncommitted").getByRole("button", { name: "View as Tree" }).click()
  const renamed = pane(page, "Uncommitted").getByRole("treeitem", { name: "start.md", exact: true })
  await expect(renamed).toContainText("renamed")
  await expect(renamed).not.toContainText("+0")
})

test("marking a file Viewed closes it and moves to the next file not yet viewed", async ({ page }) => {
  await openReview(page, "review=working#f=guides/start.md")
  const viewed = (file: string) => reviewFile(page, file).getByRole("button", { name: "Viewed" })
  await expect(viewed("guides/start.md")).toBeEnabled()
  await expect(viewed("guides/start.md")).toHaveAttribute("aria-keyshortcuts", "v")
  await expect(viewed("guides/start.md")).toHaveAttribute("title", "Mark as viewed (V)")
  await viewed("guides/start.md").click()
  await expect(fileToggle(page, "guides/start.md")).toHaveAttribute("aria-expanded", "false")
  await expect(page).toHaveURL(/#f=notes\/removed\.md$/)
  await expect(reviewFile(page, "notes/removed.md").locator(".review-file-header")).toBeInViewport()

  // Past the last file it wraps to the first one not yet viewed.
  await openReview(page, "review=working#f=untracked.txt")
  await viewed("untracked.txt").click()
  await expect(page).toHaveURL(/#f=assets\/logo\.bin$/)
  // Unmarking opens the file and stays put.
  await viewed("untracked.txt").click()
  await expect(fileToggle(page, "untracked.txt")).toHaveAttribute("aria-expanded", "true")
  await expect(page).toHaveURL(/#f=assets\/logo\.bin$/)
})

test("] and [ move between a review's files and v toggles Viewed on the file in view", async ({ page }) => {
  await openReview(page, "review=working#f=README.md")
  await expect(page.getByRole("main").locator(".review")).toHaveAttribute("aria-keyshortcuts", "] [ v")
  await expect(reviewFile(page, "README.md").getByRole("button", { name: "Viewed" })).toBeEnabled()
  await page.getByRole("main").focus()
  await page.keyboard.press("]")
  await expect(page).toHaveURL(/#f=untracked\.txt$/)
  // The last file has no next one.
  await page.keyboard.press("]")
  await expect(page).toHaveURL(/#f=untracked\.txt$/)
  await page.keyboard.press("[")
  await expect(page).toHaveURL(/#f=README\.md$/)
  await page.keyboard.press("[")
  await expect(page).toHaveURL(/#f=large\.txt$/)

  await page.keyboard.press("v")
  await expect(reviewFile(page, "large.txt").getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true")
  await expect(fileToggle(page, "large.txt")).toHaveAttribute("aria-expanded", "false")
  await expect(page).toHaveURL(/#f=README\.md$/)
  await expect(page.getByRole("main").getByText(`1 of ${gitFixtureChanges} viewed`)).toBeVisible()
  // Modified keys stay with the browser.
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL(/#f=README\.md$/)
})

test("the Files rail filters by path and hides viewed files, remembered per browser", async ({ page }) => {
  await openReview(page, "review=branch&uncommitted=1#f=clean.md")
  await expect(railFile(page, "clean.md")).toBeVisible()
  // A rename without line changes reads renamed in the rail too.
  await expect(railFile(page, "start.md")).toContainText("renamed")
  await expect(railFile(page, "start.md")).not.toContainText("+0")

  const filter = rail(page).getByRole("textbox", { name: "Filter files by path" })
  await filter.fill("guides")
  await expect(railFile(page, "start.md")).toBeVisible()
  await expect(railFile(page, "clean.md")).toHaveCount(0)
  await expect(rail(page).getByRole("status")).toHaveText(/^1 \/ \d+1 of \d+ files shown$/)
  // Review keys never fire in a text field.
  await filter.press("]")
  await expect(filter).toHaveValue("guides]")
  await expect(page).toHaveURL(/#f=clean\.md$/)
  await filter.fill("nothing-matches")
  await expect(rail(page).getByText("No files match.")).toBeVisible()
  await filter.press("Escape")
  await expect(filter).toHaveValue("")
  await expect(railFile(page, "clean.md")).toBeVisible()

  await reviewFile(page, "clean.md").getByRole("button", { name: "Viewed" }).click()
  await expect(reviewFile(page, "clean.md").getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true")
  const hideViewed = rail(page).getByRole("button", { name: "Hide viewed files" })
  await expect(hideViewed).toHaveAttribute("aria-pressed", "false")
  await hideViewed.click()
  await expect(hideViewed).toHaveAttribute("aria-pressed", "true")
  await expect(railFile(page, "clean.md")).toHaveCount(0)
  await expect(railFile(page, "start.md")).toBeVisible()

  await page.reload()
  await expect(rail(page).getByRole("button", { name: "Hide viewed files" })).toHaveAttribute("aria-pressed", "true")
  await expect(railFile(page, "start.md")).toBeVisible()
  await expect(railFile(page, "clean.md")).toHaveCount(0)
})

test("the diff toolbar keeps layout and steps on the bar and the rest in View options", async ({ page }) => {
  await openReview(page, "review=branch#f=clean.md")
  for (const name of ["Split", "Unified", "Previous change", "Next change", "Collapse All Files", "Files"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
  }
  for (const name of ["Wrap lines", "Ignore whitespace", "Expand unchanged lines"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0)
  }
  const trigger = page.getByRole("button", { name: "View options" })
  await expect(trigger).not.toHaveAttribute("data-modified")
  await trigger.click()
  const menu = page.getByRole("menu", { name: "View options" })
  const wrap = menu.getByRole("menuitemcheckbox", { name: "Wrap lines" })
  await expect(wrap).toHaveAttribute("aria-checked", "false")
  await wrap.click()
  // The menu stays open for further choices.
  await expect(wrap).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitemradio", { name: "Word" })).toHaveAttribute("aria-checked", "true")
  await menu.getByRole("menuitemradio", { name: "Character" }).click()
  await expect(menu.getByRole("menuitemradio", { name: "Character" })).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitemcheckbox", { name: "Ignore whitespace" })).toHaveAttribute("aria-checked", "false")
  await expect(menu.getByRole("menuitemcheckbox", { name: "Expand unchanged lines" })).toHaveAttribute("aria-checked", "false")
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(trigger).toHaveAttribute("data-modified", "true")
  await expect(reviewFile(page, "clean.md").locator(".diff-view pre[data-overflow]")).toHaveAttribute("data-overflow", "wrap")

  await page.reload()
  await page.getByRole("button", { name: "View options" }).click()
  await expect(page.getByRole("menu", { name: "View options" }).getByRole("menuitemcheckbox", { name: "Wrap lines" })).toHaveAttribute("aria-checked", "true")
})

test("closing the last review tab ends every diff worker", async ({ page }) => {
  await openReview(page, "review=working#f=src/app.ts")
  await expect(diffLines(page, "change-addition", "src/app.ts").first()).toBeVisible()
  await expect.poll(() => page.workers().length).toBeGreaterThan(0)
  const tab = page.getByRole("tab", { name: "Uncommitted", exact: true })
  await tab.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(tab).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
})

function commitFilter(page: Page) {
  return pane(page, "Commits").getByRole("search", { name: "Filter commits" })
}

function commitQuery(page: Page) {
  return commitFilter(page).getByRole("textbox", { name: "Filter commits by message, author, or hash" })
}

// commitsMessage is the Commits pane's visible status, not its live region.
function commitsMessage(page: Page, text: string) {
  return pane(page, "Commits").locator(".source-control-message").getByText(text, { exact: true })
}

function filterButton(page: Page) {
  return pane(page, "Commits").getByRole("button", { name: "Filter Commits" })
}

test("the commit filter matches messages and hashes, and Escape clears and hides it", async ({ page }) => {
  await openSourceControl(page)
  await expect(commitRow(page, featureSubject)).toBeVisible()
  await expect(commitFilter(page)).toHaveCount(0)
  await filterButton(page).click()
  await expect(filterButton(page)).toHaveAttribute("aria-pressed", "true")
  await expect(commitQuery(page)).toBeFocused()

  await commitQuery(page).fill("GUIDE index")
  await expect(commitsList(page).getByRole("option")).toHaveCount(1)
  await expect(commitRow(page, lowerSubject)).toBeVisible()
  // Branch and All still apply to the filtered list.
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  await commitQuery(page).fill("initial")
  await expect(commitRow(page, "Initial")).toBeVisible()
  await expect(commitsList(page).getByRole("option")).toHaveCount(1)
  await commitQuery(page).fill("no such commit")
  await expect(commitsMessage(page, "No commits match.")).toBeVisible()
  // A live region announces filtered results.
  await expect(pane(page, "Commits").locator('[aria-live="polite"]')).toHaveText("No commits match.")

  await commitQuery(page).press("Escape")
  await expect(commitFilter(page)).toHaveCount(0)
  await expect(filterButton(page)).toBeFocused()
  await expect(filterButton(page)).toHaveAttribute("aria-pressed", "false")
  await expect(commitsList(page).getByRole("option")).toHaveCount(3)
})

test("Show File History in the Explorer menu filters commits to the file and opens reviews at it", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/?project=${project}`)
  await page.keyboard.press("ControlOrMeta+Shift+e")
  await page.getByRole("treeitem", { name: "clean.md", exact: true }).click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Actions for clean.md" })
  await expect(menu.getByRole("menuitem")).toHaveText(["Show File History", "Copy Path", "Copy Relative Path"])
  await menu.getByRole("menuitem", { name: "Show File History" }).click()

  await expect(sourceControl(page)).toBeVisible()
  await expect(commitQuery(page)).toBeFocused()
  await expect(commitFilter(page).getByRole("button", { name: "Remove path filter clean.md" })).toBeVisible()
  // The branch range holds one commit that touches clean.md; All adds the
  // commit that created it.
  await expect(commitsList(page).getByRole("option")).toHaveCount(1)
  await expect(commitRow(page, featureSubject)).toBeVisible()
  await pane(page, "Commits").getByRole("button", { name: "All", exact: true }).click()
  await expect(commitsList(page).getByRole("option")).toHaveCount(2)
  await expect(commitRow(page, "Initial")).toBeVisible()

  await commitRow(page, featureSubject).click()
  await expect(commitTab(page, featureSubject)).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}#f=clean\.md$/)

  await commitFilter(page).getByRole("button", { name: "Remove path filter clean.md" }).click()
  await expect(commitsList(page).getByRole("option")).toHaveCount(3)
  await expect(commitQuery(page)).toBeFocused()
})

test("the tab menu and the command palette show a working-tree document's history", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=clean.md`)
  const tab = page.getByRole("tab", { name: "clean.md" })
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await tab.click({ button: "right" })
  await page.getByRole("menu", { name: "Tab actions for clean.md" }).getByRole("menuitem", { name: "Show File History" }).click()
  await expect(commitFilter(page).getByRole("button", { name: "Remove path filter clean.md" })).toBeVisible()
  await expect(commitQuery(page)).toBeFocused()
  await commitQuery(page).press("Escape")
  await expect(commitFilter(page)).toHaveCount(0)

  await tab.click()
  await page.keyboard.press("F1")
  await page.keyboard.type("show file history")
  await page.keyboard.press("Enter")
  await expect(commitFilter(page).getByRole("button", { name: "Remove path filter clean.md" })).toBeVisible()
  await expect(commitRow(page, featureSubject)).toBeVisible()
})

test("a filtered search that stops on the scan cap continues from its cursor", async ({ page }) => {
  const skips: string[] = []
  await page.route("**/api/commits?*", async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get("path") !== "clean.md") return route.continue()
    skips.push(params.get("skip") ?? "")
    const response = await route.fetch()
    const body: unknown = await response.json()
    if (typeof body !== "object" || body === null) throw new Error("unexpected commits response")
    // The first page tests 10,000 commits and finds none.
    if (!params.has("skip")) return route.fulfill({ response, json: { ...body, commits: [], more: true, next: 10000 } })
    await route.fulfill({ response })
  })
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=clean.md`)
  await page.getByRole("tab", { name: "clean.md" }).click({ button: "right" })
  await page.getByRole("menu", { name: "Tab actions for clean.md" }).getByRole("menuitem", { name: "Show File History" }).click()
  await expect(commitsMessage(page, "No commits match in the 10,000 most recent commits.")).toBeVisible()
  await pane(page, "Commits").getByRole("button", { name: "Search older commits" }).click()
  // Load more continues from the cursor, not from the commits listed.
  await expect.poll(() => skips.filter(Boolean)).toEqual(["10000"])
  await expect(commitsMessage(page, "No commits match.")).toBeVisible()
})

// changeMarks are Source's gutter change markers (decision 0115).
function changeMarks(page: Page) {
  return page.getByRole("textbox", { name: /source$/ }).getByRole("button", { name: /^(Added|Modified|Deleted) / })
}

test("Source marks a changed file's lines and opens the review at a mark", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=src/app.ts`)
  await expect(changeMarks(page)).toHaveCount(2)
  const first = changeMarks(page).first()
  await expect(first).toHaveAccessibleName("Modified line 1")
  await expect(first).toHaveAttribute("title", "Modified line 1")
  await expect(changeMarks(page).nth(1)).toHaveAccessibleName("Modified line 4")
  // A mark is part of the gutter but never selects lines.
  await changeMarks(page).nth(1).click()
  await expect(page).toHaveURL(/[?&]review=working#f=src\/app\.ts&R4$/)
  await expect(page.getByRole("tab", { name: "Uncommitted", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".status-lines")).toHaveText("Ln 4")
  await expect(reviewFile(page, "src/app.ts").locator(".diff-view [data-line][data-selected-line]").first()).toBeVisible()

  // Untracked files are added whole; unchanged files and snapshots show none.
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=untracked.txt`)
  await expect(changeMarks(page)).toHaveCount(1)
  await expect(changeMarks(page).first()).toHaveAccessibleName(/^Added line/)
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=clean.md#L1`)
  await expect(page.getByRole("textbox", { name: /source$/ })).toContainText("Edited on the feature branch.")
  await expect(changeMarks(page)).toHaveCount(0)
})

test("Source change marks follow live edits and leave with the change", async ({ page, live }) => {
  const file = path.join(live.root, "src/app.ts")
  const original = readFileSync(file, "utf8")
  try {
    await page.goto(`${live.origin}/view?project=${encodeURIComponent(live.root)}&path=src/app.ts`)
    await expect(changeMarks(page)).toHaveCount(2)
    writeFileSync(file, `${original}// tail\n\n`)
    await expect(page.getByRole("button", { name: "Added lines 6–7" })).toBeVisible()
    await expect(changeMarks(page)).toHaveCount(3)
    // Back at HEAD's text the file leaves the change set.
    writeFileSync(file, "export const answer = 1\n\nexport function run() {\n  return answer\n}\n")
    await expect(page.getByRole("textbox", { name: /source$/ })).toContainText("answer = 1")
    await expect(changeMarks(page)).toHaveCount(0)
  } finally {
    writeFileSync(file, original)
  }
})
