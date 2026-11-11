import type { NativeMenuItem } from "../lib/desktop-bridge.ts"
import { stepLabel, type HistoryStep } from "./navigation-history.ts"

// Back and Forward follow VS Code's bindings (decision 0131): Ctrl+Alt+- and
// Ctrl+Shift+- outside macOS, Ctrl+- and Ctrl+Shift+- on macOS. Pure helpers
// for the buttons, their lists, and the keys.

export type HistoryDirection = -1 | 1

export function shortcutLabel(direction: HistoryDirection, mac: boolean): string {
  if (direction < 0) return mac ? "⌃-" : "Ctrl+Alt+-"
  return mac ? "⌃⇧-" : "Ctrl+Shift+-"
}

export interface KeyPress {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

// historyKey is the direction a key press moves, or null. In the desktop
// app the Go menu owns the VS Code keys; the page adds the browser's own
// (Alt+Left/Right, Cmd+[ and Cmd+]), which a browser already handles.
export function historyKey(press: KeyPress, mac: boolean, desktop: boolean): HistoryDirection | null {
  const { altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift } = press
  if (desktop) {
    if (mac && meta && !ctrl && !alt && !shift) {
      if (press.code === "BracketLeft") return -1
      if (press.code === "BracketRight") return 1
    }
    if (!mac && alt && !ctrl && !meta && !shift) {
      if (press.key === "ArrowLeft") return -1
      if (press.key === "ArrowRight") return 1
    }
    return null
  }
  if (press.code !== "Minus" || !ctrl || meta) return null
  if (shift) return alt ? null : 1
  return mac === !alt ? -1 : null
}

// mouseDirection is the direction a mouse's side buttons move.
export function mouseDirection(button: number): HistoryDirection | null {
  return button === 3 ? -1 : button === 4 ? 1 : null
}

// buttonTitle is a button's tooltip: where it leads and its key.
export function buttonTitle(direction: HistoryDirection, step: HistoryStep | undefined, project: string, mac: boolean): string {
  const verb = direction < 0 ? "Back" : "Forward"
  if (!step) return direction < 0 ? "No earlier location" : "No later location"
  return `${verb} to ${stepLabel(step.entry, project)} (${shortcutLabel(direction, mac)})`
}

const menuPrefix = "history:"

// historyMenuItems lists the steps a button's menu offers, nearest first.
export function historyMenuItems(steps: readonly HistoryStep[], project: string): NativeMenuItem[] {
  return steps.map((step) => ({ id: `${menuPrefix}${step.delta}`, label: stepLabel(step.entry, project) }))
}

// historyMenuDelta reads the step a menu item names, or null.
export function historyMenuDelta(id: string | null): number | null {
  if (!id?.startsWith(menuPrefix)) return null
  const delta = Number(id.slice(menuPrefix.length))
  return Number.isInteger(delta) && delta !== 0 ? delta : null
}
