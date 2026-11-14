import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, test } from "@playwright/test"

// `zero --remote --web` over real TLS, in the built binary (decision 0098).
// The dev proxy every other spec runs behind has no TLS or token.
const binary = process.env.ZERO_BROWSER_BINARY ?? ""
test.skip(binary === "", "needs the built zero binary")

test("the browser link signs in once, and the server counts the page as a UI", async ({ page, browser }) => {
  const home = mkdtempSync(path.join(tmpdir(), "sfw-"))
  const run = path.join(home, "run")
  const project = path.join(home, "project")
  mkdirSync(run, { mode: 0o700 })
  mkdirSync(project)
  writeFileSync(path.join(project, "guide.md"), "# Remote guide\n")
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_RUNTIME_DIR: run,
    NO_COLOR: "1",
  }
  const zero = (...args: string[]) => execFileSync(binary, args, { env, encoding: "utf8" })
  const clients = () => {
    const status: unknown = JSON.parse(zero("remote", "status", "--json"))
    return typeof status === "object" && status !== null && "clients" in status ? status.clients : null
  }
  try {
    const printed = zero(project, "--remote", "--web", "--host", "127.0.0.1", "--port", "0")
    const link = /web:\s+(https:\S+)/.exec(printed)?.[1]
    expect(link, printed).toBeTruthy()
    const signIn = new URL(link ?? "")

    // Anyone without the token gets nothing.
    const stranger = await browser.newContext({ ignoreHTTPSErrors: true })
    const refused = await stranger.request.get(`${signIn.origin}/api/projects`)
    expect(refused.status()).toBe(401)
    const strangerPage = await stranger.newPage()
    const answered = await strangerPage.goto(`${signIn.origin}/`)
    expect(answered?.status()).toBe(401)
    await stranger.close()

    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const signedIn = await context.newPage()
    await signedIn.goto(signIn.href)
    // The token leaves the address bar, and history, for an HttpOnly cookie.
    expect(signedIn.url()).not.toContain("token")
    const cookies = await context.cookies()
    expect(cookies.map((cookie) => [cookie.name, cookie.httpOnly, cookie.secure, cookie.sameSite])).toEqual([["zero_remote", true, true, "Strict"]])
    expect(await signedIn.evaluate(() => document.cookie)).toBe("")

    await signedIn.goto(`${signIn.origin}/view?${new URLSearchParams({ project, path: "guide.md" }).toString()}`)
    await expect(signedIn.getByRole("textbox", { name: "Markdown source" })).toContainText("# Remote guide")
    await expect.poll(clients).toBe(1)

    await signedIn.close()
    await expect.poll(clients).toBe(0)
    await context.close()
  } finally {
    await page.close()
    zero("daemon", "stop")
    rmSync(home, { recursive: true, force: true })
  }
})

// Open folder over a remote connection browses the server's disk and serves
// the folder; Stop serving removes it (decision 0146).
test("Open folder serves a host folder and Stop serving removes it", async ({ browser }) => {
  const home = mkdtempSync(path.join(tmpdir(), "sfo-"))
  const run = path.join(home, "run")
  const project = path.join(home, "project")
  const other = path.join(home, "other")
  mkdirSync(run, { mode: 0o700 })
  mkdirSync(project)
  mkdirSync(other)
  mkdirSync(path.join(home, "repo", ".git"), { recursive: true })
  mkdirSync(path.join(home, ".hidden"))
  writeFileSync(path.join(project, "guide.md"), "# Remote guide\n")
  writeFileSync(path.join(other, "notes.md"), "# Other notes\n")
  // Root reads every folder, so the unreadable cases need another user.
  const unreadable = process.getuid?.() !== 0
  const locked = path.join(home, "locked")
  if (unreadable) {
    mkdirSync(locked)
    chmodSync(locked, 0)
  }
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_RUNTIME_DIR: run,
    NO_COLOR: "1",
  }
  const zero = (...args: string[]) => execFileSync(binary, args, { env, encoding: "utf8" })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  try {
    const printed = zero(project, "--remote", "--web", "--host", "127.0.0.1", "--port", "0")
    const link = /web:\s+(https:\S+)/.exec(printed)?.[1]
    expect(link, printed).toBeTruthy()
    const signIn = new URL(link ?? "")
    const page = await context.newPage()
    await page.goto(signIn.href)
    await page.goto(`${signIn.origin}/?${new URLSearchParams({ project }).toString()}`)
    await expect(page.getByRole("treeitem", { name: "guide.md" })).toBeVisible()

    // `/` browses from home: plain folders, repositories, no dot folders.
    await page.keyboard.press("Control+o")
    const picker = page.getByRole("combobox", { name: "Switch project" })
    await expect(picker).toBeFocused()
    await picker.press("/")
    const folderPath = page.getByRole("combobox", { name: "Folder path" })
    await expect(folderPath).toHaveValue(`${home}/`)
    const folders = page.getByRole("listbox", { name: "Folders" })
    await expect(folders.getByRole("option", { name: /other/ })).toBeVisible()
    await expect(folders.getByRole("option", { name: /repo/ })).toBeVisible()
    await expect(folders.getByRole("option", { name: /\.hidden/ })).toHaveCount(0)
    if (unreadable) {
      await expect(folders.getByRole("option", { name: /locked/ })).toContainText("Can't read")
      await folderPath.fill(`${locked}/`)
      await folders.getByRole("option", { name: /^Open/ }).click()
      await expect(page.getByRole("status")).toContainText(`zero can't read ${locked}`)
    }

    // Opening a folder serves it and switches to it.
    await folderPath.fill(`${other}/`)
    await folders.getByRole("option", { name: /^Open/ }).click()
    await expect(page).toHaveURL(new RegExp(`project=${encodeURIComponent(other)}`))
    await expect(page.getByRole("treeitem", { name: "notes.md" })).toBeVisible()

    // Stopping the current project's folder lands on the next served one.
    await page.keyboard.press("Control+o")
    await page.getByRole("button", { name: `Stop serving ${other}` }).click()
    await expect(page).toHaveURL(new RegExp(`project=${encodeURIComponent(project)}`))
    const roots = await context.request.get(`${signIn.origin}/api/projects`)
    const listed: unknown = await roots.json()
    expect(JSON.stringify(listed)).not.toContain(other)

    // A served folder that turns unreadable explains itself and can stop.
    if (unreadable) {
      await page.keyboard.press("Control+o")
      await page.getByRole("combobox", { name: "Switch project" }).press("/")
      await folderPath.fill(`${other}/`)
      await folders.getByRole("option", { name: /^Open/ }).click()
      await expect(page.getByRole("treeitem", { name: "notes.md" })).toBeVisible()
      chmodSync(other, 0)
      await page.reload()
      await expect(page.getByRole("alert")).toContainText(`zero can't read ${other}`)
      await page.getByRole("button", { name: "Stop serving other" }).click()
      await expect(page).toHaveURL(new RegExp(`project=${encodeURIComponent(project)}`))
      chmodSync(other, 0o755)
    }
  } finally {
    await context.close()
    zero("daemon", "stop")
    if (unreadable) chmodSync(locked, 0o755)
    chmodSync(other, 0o755)
    rmSync(home, { recursive: true, force: true })
  }
})
