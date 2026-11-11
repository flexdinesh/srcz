import { Menu } from "@base-ui/react/menu"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"

import { IconButton } from "../components/ui/icon-button.tsx"
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../components/ui/menu.ts"
import { desktopBridge } from "../lib/desktop-bridge.ts"
import { buttonTitle, historyMenuDelta, historyMenuItems, type HistoryDirection } from "./history-controls.ts"
import { canGoBack, canGoForward, steps, type HistoryLog } from "./navigation-history.ts"
import type { NavigationHistoryStore } from "./navigation-history-store.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")
// A held button opens its list, as a browser's Back does.
const longPress = 500

interface NavigationButtonsProps {
  log: HistoryLog
  store: NavigationHistoryStore
  // project is the one on screen; other projects' entries name theirs.
  project: string
}

interface OpenMenu {
  direction: HistoryDirection
  anchor: HTMLElement
}

// NavigationButtons are Back and Forward before the tabs, as Zed's pane has
// (decision 0131). A click moves one entry; right-click, a long press, or
// the context-menu keys list where each leads.
export function NavigationButtons({ log, project, store }: NavigationButtonsProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // held is set when a long press opened the list, so its click does not move.
  const held = useRef(false)
  const showContextMenu = desktopBridge()?.showContextMenu ?? null

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function openList(direction: HistoryDirection, anchor: HTMLElement, x: number, y: number) {
    const reachable = steps(log, direction)
    if (reachable.length === 0) return
    if (!showContextMenu) {
      setMenu({ direction, anchor })
      return
    }
    void showContextMenu(historyMenuItems(reachable, project), x, y).then((id) => {
      const delta = historyMenuDelta(id)
      if (delta !== null) store.go(delta)
    })
  }

  function cancelHold() {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  function button(direction: HistoryDirection) {
    const enabled = direction < 0 ? canGoBack(log) : canGoForward(log)
    const [next] = steps(log, direction, 1)
    const label = direction < 0 ? "Go Back" : "Go Forward"
    const title = buttonTitle(direction, next, project, mac)
    return (
      <IconButton
        className="history-button"
        size="bar"
        label={label}
        title={title}
        disabledReason={enabled ? undefined : title}
        aria-haspopup="menu"
        aria-expanded={menu?.direction === direction}
        icon={direction < 0 ? <ArrowLeftIcon aria-hidden="true" /> : <ArrowRightIcon aria-hidden="true" />}
        onClick={() => {
          if (held.current) held.current = false
          else store.go(direction)
        }}
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          cancelHold()
          openList(direction, event.currentTarget, event.clientX, event.clientY)
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0 || !enabled) return
          held.current = false
          const anchor = event.currentTarget
          const { clientX: x, clientY: y } = event
          cancelHold()
          timer.current = window.setTimeout(() => {
            held.current = true
            openList(direction, anchor, x, y)
          }, longPress)
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          openList(direction, event.currentTarget, bounds.left, bounds.bottom)
        }}
      />
    )
  }

  const listed = menu ? steps(log, menu.direction) : []
  return (
    <div className="history-buttons" role="group" aria-label="History">
      {button(-1)}
      {button(1)}
      {menu && listed.length > 0 && (
        <Menu.Root open modal={false} onOpenChange={(open) => {
          if (open) return
          const { anchor } = menu
          setMenu(null)
          anchor.focus({ preventScroll: true })
        }}>
          <Menu.Portal>
            <Menu.Positioner className={menuPositionerClass} anchor={menu.anchor} side="bottom" align="start" sideOffset={2}>
              <Menu.Popup className={menuPopupClass} aria-label={menu.direction < 0 ? "Back history" : "Forward history"}>
                {historyMenuItems(listed, project).map((item) => "separator" in item ? null : (
                  <Menu.Item key={item.id} className={menuItemClass} onClick={() => {
                    const delta = historyMenuDelta(item.id)
                    setMenu(null)
                    if (delta !== null) store.go(delta)
                  }}>
                    {item.label}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}
