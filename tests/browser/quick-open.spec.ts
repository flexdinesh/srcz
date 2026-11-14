import { expect, test, type Page } from "@playwright/test"

// Quick Open (decision 0145): Cmd/Ctrl+P finds a file by name in a popup.
const dialog = (page: Page) => page.getByRole("dialog", { name: "Go to file" })
const field = (page: Page) => dialog(page).getByRole("combobox", { name: "Go to file" })
const options = (page: Page) => dialog(page).getByRole("option")
const selectedTab = (page: Page) => page.getByRole("tablist", { name: "Open documents" }).getByRole("tab", { selected: true })

// open loads a document and waits for the workspace before using its keys.
async function open(page: Page, path: string) {
  await page.goto(`/view?path=${encodeURIComponent(path)}`)
  await expect(selectedTab(page)).toHaveText(path.split("/").at(-1) ?? path)
}

test("Ctrl/Cmd+P lists recent files, fuzzy matches open a file, and Escape restores focus", async ({ page }) => {
  await page.goto("/view?path=guides%2Fgetting-started.md")
  const tree = page.getByRole("complementary", { name: "Files" })
  await tree.getByRole("treeitem", { name: "README.md", exact: true }).click()
  await tree.getByRole("treeitem", { name: "code-blocks.md", exact: true }).click()
  await expect(selectedTab(page)).toHaveText("code-blocks.md")
  const row = tree.getByRole("treeitem", { name: "code-blocks.md", exact: true })
  await row.focus()

  await page.keyboard.press("ControlOrMeta+P")
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveAttribute("placeholder", "Search files by name (append : to go to line)")
  await expect(dialog(page).getByText("recently opened")).toBeVisible()
  // Most recent first, without the file on screen.
  await expect(options(page)).toHaveCount(2)
  await expect(options(page).nth(0)).toHaveAccessibleName("README.md")
  await expect(options(page).nth(1)).toHaveAccessibleName("getting-started.md, guides")
  await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Escape")
  await expect(dialog(page)).toBeHidden()
  await expect(row).toBeFocused()

  await page.keyboard.press("ControlOrMeta+K")
  await field(page).fill("stgs yml")
  await expect(options(page).first()).toHaveAccessibleName("settings.yaml, config")
  await expect(options(page).first().locator("mark").first()).toBeVisible()
  await field(page).press("ArrowDown")
  await field(page).press("ArrowUp")
  await field(page).press("Enter")
  await expect(dialog(page)).toBeHidden()
  await expect(page).toHaveURL(/path=config%2Fsettings.yaml/)
  await expect(selectedTab(page)).toHaveText("settings.yaml")
  // Opening a file leaves the sidebar alone.
  await expect(tree).toBeVisible()
})

test("no match says so, and the header's Search files opens Quick Open", async ({ page }) => {
  await page.goto("/view?path=README.md")
  await page.getByRole("complementary", { name: "Files" }).getByRole("button", { name: "Search files" }).click()
  await expect(field(page)).toBeFocused()
  await field(page).fill("zzqqxx")
  await expect(dialog(page).getByRole("status")).toHaveText("No matching files")
  await expect(options(page)).toHaveCount(0)
})

test("path:line opens a file at the line; a bare :line moves in the document on screen", async ({ page }) => {
  await open(page, "README.md")
  await page.keyboard.press("ControlOrMeta+P")
  await field(page).fill("getting-started:4")
  await expect(options(page).first()).toHaveAccessibleName("getting-started.md, guides, line 4")
  await field(page).press("Enter")
  await expect(page).toHaveURL(/path=guides%2Fgetting-started.md#L4$/)

  await page.keyboard.press("ControlOrMeta+P")
  await field(page).fill(":7")
  await expect(options(page)).toHaveCount(1)
  await expect(options(page).first()).toHaveAccessibleName("Go to line 7 in getting-started.md")
  await field(page).press("Enter")
  await expect(page).toHaveURL(/path=guides%2Fgetting-started.md#L7$/)
})

test("a bare :line without a text document explains itself", async ({ page }) => {
  await open(page, "assets/preview.png")
  await page.keyboard.press("ControlOrMeta+P")
  await field(page).fill(":3")
  await expect(dialog(page).getByRole("status")).toHaveText("Open a text document to go to a line")
  await expect(options(page)).toHaveCount(0)
})

test("> hands off to the command palette and Backspace comes back", async ({ page }) => {
  await open(page, "README.md")
  await page.keyboard.press("ControlOrMeta+P")
  await field(page).press(">")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  const command = palette.getByRole("combobox", { name: "Command" })
  await expect(dialog(page)).toBeHidden()
  await expect(command).toBeFocused()
  await expect(command).toHaveValue("")
  await command.pressSequentially("font")
  await expect(palette.getByRole("option").first()).toHaveAccessibleName("Settings: Font Size, 13px")
  await command.fill("")
  await command.press("Backspace")
  await expect(palette).toBeHidden()
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue("")
})

test("the palette's Go to File opens Quick Open", async ({ page }) => {
  await open(page, "README.md")
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const command = page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox", { name: "Command" })
  await command.fill("go to file")
  await command.press("Enter")
  await expect(field(page)).toBeFocused()
})

test("on phones Quick Open uses touch rows and opens files without the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, "README.md")
  await page.keyboard.press("ControlOrMeta+P")
  await field(page).fill("app")
  const first = options(page).first()
  await expect(first).toBeVisible()
  const box = await first.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  await first.click()
  await expect(dialog(page)).toBeHidden()
  await expect(page.getByRole("dialog", { name: "Files", exact: true })).toBeHidden()
  await expect(page).toHaveURL(/path=.*app\./)
})
