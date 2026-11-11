import { expect, test, type Page } from "@playwright/test"

import { endsWith, fixtureRoot, projectParam, rootParam } from "./fixture-root.ts"

const back = (page: Page) => page.getByRole("group", { name: "History" }).getByRole("button", { name: "Go Back" })
const forward = (page: Page) => page.getByRole("group", { name: "History" }).getByRole("button", { name: "Go Forward" })
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open documents" })
const selected = (page: Page) => tabs(page).getByRole("tab", { selected: true })
const backKey = process.platform === "darwin" ? "Control+Minus" : "Control+Alt+Minus"

// Three places: getting-started.md, README.md, code-blocks.md.
async function visitThree(page: Page) {
  await page.goto("/view?path=guides%2Fgetting-started.md")
  const tree = page.getByRole("complementary", { name: "Files" })
  await tree.getByRole("treeitem", { name: "README.md", exact: true }).click()
  await tree.getByRole("treeitem", { name: "code-blocks.md", exact: true }).click()
  await expect(selected(page)).toHaveText("code-blocks.md")
}

test("Back and Forward move one place and name where they lead", async ({ page }) => {
  await page.goto("/view?path=guides%2Fgetting-started.md")
  await expect(back(page)).toHaveAttribute("aria-disabled", "true")
  await expect(back(page)).toHaveAttribute("title", "No earlier location")
  await expect(forward(page)).toHaveAttribute("aria-disabled", "true")
  await page.getByRole("complementary", { name: "Files" }).getByRole("treeitem", { name: "README.md", exact: true }).click()
  await expect(back(page)).toHaveAttribute("title", /^Back to getting-started\.md \(/)

  await back(page).click()
  await expect(selected(page)).toHaveText("getting-started.md")
  await expect(back(page)).toHaveAttribute("aria-disabled", "true")
  await expect(forward(page)).toHaveAttribute("title", /^Forward to README\.md \(/)
  await forward(page).click()
  await expect(selected(page)).toHaveText("README.md")
  await expect(forward(page)).toHaveAttribute("aria-disabled", "true")
})

test("Back reopens a closed tab", async ({ page }) => {
  await visitThree(page)
  await page.getByRole("button", { name: "Close guides/code-blocks.md", exact: true }).click()
  await expect(tabs(page).getByRole("tab")).toHaveText(["getting-started.md", "README.md"])
  // Closing selected README.md: Back returns to the closed tab.
  await back(page).click()
  await expect(selected(page)).toHaveText("code-blocks.md")
})

test("a button's list jumps several places and keeps Forward", async ({ page }) => {
  await visitThree(page)
  await back(page).click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Back history" })
  await expect(menu.getByRole("menuitem")).toHaveText(["README.md", "getting-started.md"])
  await menu.getByRole("menuitem", { name: "getting-started.md" }).click()
  await expect(selected(page)).toHaveText("getting-started.md")
  await forward(page).click({ button: "right" })
  await expect(page.getByRole("menu", { name: "Forward history" }).getByRole("menuitem")).toHaveText(["README.md", "code-blocks.md"])
  await page.keyboard.press("Escape")
  await expect(forward(page)).toBeFocused()
})

test("holding a button opens its list", async ({ page }) => {
  await visitThree(page)
  const box = await back(page).boundingBox()
  if (!box) throw new Error("no Back button")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(page.getByRole("menu", { name: "Back history" })).toBeVisible()
  await page.mouse.up()
  // The press that opened the list does not also go back.
  await expect(selected(page)).toHaveText("code-blocks.md")
})

test("VS Code's keys and the palette move through history", async ({ page }) => {
  await visitThree(page)
  await page.keyboard.press(backKey)
  await expect(selected(page)).toHaveText("README.md")
  await page.keyboard.press("Control+Shift+Minus")
  await expect(selected(page)).toHaveText("code-blocks.md")

  await page.keyboard.press("F1")
  await page.getByRole("combobox", { name: "Command" }).fill("go back")
  await page.keyboard.press("Enter")
  await expect(selected(page)).toHaveText("README.md")
})

test("Recent Locations opens a place as a new entry", async ({ page }) => {
  await visitThree(page)
  await page.keyboard.press("F1")
  await page.getByRole("combobox", { name: "Command" }).fill("recent locations")
  await page.keyboard.press("Enter")
  const recent = page.getByRole("listbox", { name: "Recent locations" })
  // Rows name the place, then its path when that says more.
  await expect(recent.getByRole("option")).toHaveText(["README.md", "getting-started.mdguides/getting-started.md"])
  await page.getByRole("combobox", { name: "Recent location" }).fill("getting")
  await page.keyboard.press("Enter")
  await expect(selected(page)).toHaveText("getting-started.md")
  await expect(back(page)).toHaveAttribute("title", /^Back to code-blocks\.md \(/)
  await expect(forward(page)).toHaveAttribute("aria-disabled", "true")
})

test("a reload keeps Forward and the names", async ({ page }) => {
  await visitThree(page)
  await back(page).click()
  await expect(selected(page)).toHaveText("README.md")
  await page.reload()
  await expect(selected(page)).toHaveText("README.md")
  await expect(forward(page)).toHaveAttribute("title", /^Forward to code-blocks\.md \(/)
  await forward(page).click()
  await expect(selected(page)).toHaveText("code-blocks.md")
})

test("Back crosses a project switch and names the other project", async ({ page }) => {
  await page.goto(`/view?project=${rootParam}&path=README.md`)
  await expect(selected(page)).toHaveText("README.md")
  await page.keyboard.press("Control+o")
  const picker = page.getByRole("dialog", { name: /Switch project|Open folder/ })
  // Browse folders, then complete guides.
  await expect(picker.getByRole("option").first()).toBeVisible()
  await picker.getByRole("combobox").fill("/")
  await expect(picker.getByRole("combobox")).toHaveValue(`${fixtureRoot}/`)
  await picker.getByRole("combobox").pressSequentially("gui")
  await picker.getByRole("combobox").press("Tab")
  await expect(picker.getByRole("option").first()).toHaveAccessibleName(`Open ${fixtureRoot}/guides/`)
  await picker.getByRole("combobox").press("Enter")
  await expect(page).toHaveURL(endsWith(`/view?project=${projectParam("guides")}&welcome=1`))
  await expect(back(page)).toHaveAttribute("title", /^Back to README\.md in markdown \(/)
  await back(page).click()
  await expect(page).toHaveURL(endsWith(`/view?project=${rootParam}&path=README.md`))
  await expect(selected(page)).toHaveText("README.md")
})

test("phones hide the buttons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/view?path=guides%2Fgetting-started.md")
  await expect(selected(page)).toHaveText("getting-started.md")
  await expect(page.getByRole("group", { name: "History" })).toBeHidden()
})
