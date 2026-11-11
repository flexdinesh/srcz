import type { RouterHistory } from "@tanstack/react-router"
import { useRouter } from "@tanstack/react-router"
import { useSyncExternalStore } from "react"

import { emptyLog, name, parseLog, resume, visit, type HistoryLog, type HistoryMove, type HistoryVisit } from "./navigation-history.ts"

// The log lives in this window's session storage: the browser's history
// survives a reload, so Forward and the names must too (decision 0131).
const storageKey = "zero:navigation-history"

export interface NavigationHistoryStore {
  log(): HistoryLog
  subscribe(listener: () => void): () => void
  go(delta: number): void
  // name labels the entry on screen, identified by its router key.
  name(key: string, label: string, title: string): void
}

function readStored(): HistoryLog {
  try {
    const stored = window.sessionStorage.getItem(storageKey)
    return stored ? parseLog(JSON.parse(stored)) : emptyLog
  } catch {
    return emptyLog
  }
}

function writeStored(log: HistoryLog) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(log))
  } catch { /* Without storage the log lasts until a reload. */ }
}

// entryKey identifies a history entry: the router's key for it.
export function entryKey(location: { href: string; state: { __TSR_key?: string; key?: string } }): string {
  return location.state.__TSR_key ?? location.state.key ?? location.href
}

function at(history: RouterHistory): HistoryVisit {
  const { location } = history
  return { index: location.state.__TSR_index, key: entryKey(location), href: location.href }
}

function createStore(history: RouterHistory): NavigationHistoryStore {
  let log = resume(readStored(), at(history))
  const listeners = new Set<() => void>()
  const update = (next: HistoryLog) => {
    if (next === log) return
    log = next
    writeStored(log)
    for (const listener of listeners) listener()
  }
  writeStored(log)
  history.subscribe(({ action }) => {
    const move: HistoryMove = action.type === "PUSH" ? "push" : action.type === "REPLACE" ? "replace" : "pop"
    update(visit(log, move, at(history)))
  })
  return {
    log: () => log,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    // Moves stay within the app's entries: Back never leaves the page.
    go(delta) {
      const target = log.current + delta
      if (delta !== 0 && target >= 0 && target <= log.top) history.go(delta)
    },
    name: (key, label, title) => update(name(log, key, label, title)),
  }
}

// One store per router history: it outlives the workspace, which remounts
// when the project changes.
const stores = new WeakMap<RouterHistory, NavigationHistoryStore>()

export function navigationHistoryFor(history: RouterHistory): NavigationHistoryStore {
  const existing = stores.get(history)
  if (existing) return existing
  const store = createStore(history)
  stores.set(history, store)
  return store
}

// useNavigationHistory is the log and the store that moves through it.
export function useNavigationHistory() {
  const store = navigationHistoryFor(useRouter().history)
  const log = useSyncExternalStore(store.subscribe, store.log)
  return { log, store }
}
