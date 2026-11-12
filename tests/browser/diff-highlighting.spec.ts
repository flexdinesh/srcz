import { existsSync } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { gitFixtureRoot } from "./git-fixture.ts"
import { gitApiOrigin } from "./ports.ts"

// The fixture repository is built by the git server's webServer command.
test.skip(() => !existsSync(path.join(gitFixtureRoot, ".git")), "git is not installed")

const project = encodeURIComponent(gitFixtureRoot)

// Builds ship only Highlights and zero's theme (decision 0029); this guards
// that a mapped family still highlights with zero's syntax tokens.
test("diffs highlight mapped families with zero syntax colors", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&review=working#f=src/app.ts`)
  const diff = page.getByRole("main").getByRole("region", { name: "src/app.ts", exact: true }).locator(".diff-view")
  await expect(diff.locator('[data-line-type="change-addition"]').first()).toBeVisible()
  await expect.poll(() => diff.evaluate((host) => {
    const keyword = getComputedStyle(document.documentElement).getPropertyValue("--color-syntax-keyword").trim()
    const probe = document.createElement("span")
    probe.style.color = keyword
    document.body.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    const tokens = [...(host.shadowRoot?.querySelectorAll('[data-line-type="change-addition"] span') ?? [])]
    // Highlights keeps trailing whitespace in a token.
    return tokens.some((token) => token.textContent?.trim() === "export" && getComputedStyle(token).color === expected)
  })).toBe(true)
})

// Bold syntax tokens in the bundled mono face keep Pierre's 22px rows
// (decisions 0130, 0138), so the review's reveal pin never fights a resize.
test("diff rows with bold tokens keep their row height", async ({ page }) => {
  await page.goto(`${gitApiOrigin}/view?project=${project}&review=working#f=added.md`)
  const diff = page.getByRole("main").getByRole("region", { name: "added.md", exact: true }).locator(".diff-view")
  await expect(diff.locator('[data-line-type="change-addition"]').first()).toBeVisible()
  await expect.poll(() => diff.evaluate((host) => {
    const lines = [...(host.shadowRoot?.querySelectorAll("[data-line]") ?? [])]
    const bold = lines.filter((line) => [...line.querySelectorAll("span")].some((token) => Number(getComputedStyle(token).fontWeight) >= 700))
    return {
      bold: bold.length > 0,
      heights: [...new Set(lines.map((line) => line.getBoundingClientRect().height))],
      font: lines.length > 0 ? getComputedStyle(lines[0]).fontFamily.startsWith('"JetBrains Mono Variable"') : false,
      ligatures: lines.length > 0 ? getComputedStyle(lines[0]).fontVariantLigatures : "",
    }
  })).toEqual({ bold: true, heights: [22], font: true, ligatures: "none" })
})
