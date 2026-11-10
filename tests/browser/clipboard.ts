import type { Page } from "@playwright/test"

// Playwright's WebKit has no clipboard permissions to grant, so a test's setup
// would abort there before its body runs.
export async function grantClipboard(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() === "webkit") return
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
}

// recordClipboard keeps the text the page last copied, through the
// Clipboard API or the selection fallback, for copiedText to read in every
// engine: Playwright's WebKit grants no clipboard-read, so readText fails
// there. Call it before the page loads.
export async function recordClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record = (text: string) => Reflect.set(window, "__zeroCopied", text)
    const clipboard = navigator.clipboard
    if (clipboard) {
      const write = clipboard.writeText.bind(clipboard)
      clipboard.writeText = (text: string) => {
        record(text)
        return write(text)
      }
    }
    document.addEventListener("copy", () => {
      const field = document.activeElement
      if (field instanceof HTMLTextAreaElement) record(field.value.slice(field.selectionStart, field.selectionEnd))
    }, true)
  })
}

// copiedText is the text the page last copied, as recordClipboard saw it.
export function copiedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text: unknown = Reflect.get(window, "__zeroCopied")
    return typeof text === "string" ? text : ""
  })
}
