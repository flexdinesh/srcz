import { existsSync } from "node:fs"
import path from "node:path"

import { expect, type Page } from "@playwright/test"
import { test } from "./live-test.ts"

import { featureSubject, gitFixtureRoot } from "./git-fixture.ts"
import { gitApiOrigin } from "./ports.ts"

// The fixture repository is built by the git server's webServer command.
test.skip(() => !existsSync(path.join(gitFixtureRoot, ".git")), "git is not installed")
test.use({ seed: gitFixtureRoot })

const project = encodeURIComponent(gitFixtureRoot)

function source(page: Page) {
  return page.getByRole("textbox", { name: /source$/ })
}

function inlineBlame(page: Page) {
  return source(page).getByRole("button", { name: /^Blame for line / })
}

test("inline blame follows the clicked line and opens the commit at its line", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=clean.md`)
  await expect(source(page)).toContainText("Edited on the feature branch.")
  // Nothing shows until a line is active.
  await expect(inlineBlame(page)).toHaveCount(0)

  await source(page).locator('[data-line="1"] .source-document-line-content').click()
  await expect(inlineBlame(page)).toHaveAccessibleName(/^Blame for line 1: zero, .* · Initial$/)
  await expect(source(page).locator('[data-line="1"] .blame-inline')).toHaveCount(1)

  await source(page).locator('[data-line="3"] .source-document-line-content').click()
  await expect(inlineBlame(page)).toHaveCount(1)
  await expect(source(page).locator('[data-line="3"]')).toContainText(featureSubject)

  // A press opens the card; Escape closes it.
  await inlineBlame(page).click()
  const card = page.getByRole("dialog", { name: /^Commit [0-9a-f]{7} by zero$/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText("zero@example.invalid")
  await expect(card).toContainText("Explain how the fixture's branch history is built.")
  await expect(card.getByRole("link", { name: /pull request/ })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(card).toBeHidden()

  await inlineBlame(page).click()
  await card.getByRole("button", { name: "Open Commit" }).click()
  await expect(page).toHaveURL(/[?&]commit=[0-9a-f]{40}.*#f=clean\.md&R3$/)
})

test("inline blame marks uncommitted lines, opens from the palette, and follows the setting", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&path=README.md#L4`)
  // A line anchor makes its first line active.
  await expect(inlineBlame(page)).toHaveAccessibleName("Blame for line 4: Uncommitted changes")

  await source(page).locator('[data-line="3"] .source-document-line-content').click()
  await expect(inlineBlame(page)).toHaveAccessibleName(/^Blame for line 3: zero, .* · Initial$/)

  await page.keyboard.press("ControlOrMeta+Shift+P")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await palette.getByRole("combobox", { name: "Command" }).fill("line blame")
  await palette.getByRole("option", { name: "Source Control: Show Line Blame" }).click()
  const card = page.getByRole("dialog", { name: /^Commit [0-9a-f]{7} by zero$/ })
  await expect(card.getByRole("button", { name: "Open Commit" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(card).toBeHidden()

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  await dialog.getByRole("combobox", { name: "Source Control: Inline Blame" }).selectOption("off")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await source(page).locator('[data-line="2"] .source-document-line-content').click()
  await expect(inlineBlame(page)).toHaveCount(0)
})

test.describe("phones", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true })

  test("a tap on the blame opens its card", async ({ page }) => {
    await page.goto(`${gitApiOrigin}/view?project=${project}&path=clean.md#L3`)
    await expect(inlineBlame(page)).toHaveCount(1)
    await inlineBlame(page).tap()
    const card = page.getByRole("dialog", { name: /^Commit [0-9a-f]{7} by zero$/ })
    await expect(card).toBeVisible()
    await expect(card.getByRole("button", { name: "Show File History" })).toBeVisible()
  })
})
