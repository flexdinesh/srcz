import { Menu } from "@base-ui/react/menu"
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../../components/ui/menu.ts"
import type { NativeMenuItem } from "../../lib/desktop-bridge.ts"
import { isTreeMenuAction, type TreeMenuAction } from "./tree-menu.ts"

interface TreeRowMenuProps {
  // anchor is the row's menu anchor, which Pierre places on the row.
  anchor: HTMLElement
  name: string
  items: readonly NativeMenuItem[]
  onAction(action: TreeMenuAction): void
  // onClose ends Pierre's menu; restoreFocus returns focus to the row.
  onClose(restoreFocus: boolean): void
}

// TreeRowMenu is the browser's Explorer row menu (decision 0114): the native
// menu's items on the shared menu surface, anchored to the row. Pierre owns
// opening it (right-click, the context-menu keys); Base UI owns keyboard
// and dismissal.
export function TreeRowMenu({ anchor, items, name, onAction, onClose }: TreeRowMenuProps) {
  return (
    <Menu.Root open modal={false} onOpenChange={(open) => { if (!open) onClose(true) }}>
      <Menu.Portal>
        <Menu.Positioner className={menuPositionerClass} anchor={anchor} side="bottom" align="start" sideOffset={2}>
          {/* Pierre treats clicks outside this marked root as dismissal. */}
          <Menu.Popup className={menuPopupClass} aria-label={`Actions for ${name}`} data-file-tree-context-menu-root="true">
            {items.map((item, index) => "separator" in item
              ? <Menu.Separator key={`separator-${index}`} className={menuSeparatorClass} />
              : <Menu.Item key={item.id} className={menuItemClass} disabled={item.enabled === false} onClick={() => {
                const id = item.id
                // Show File History moves focus to Source Control.
                onClose(id !== "file-history")
                if (isTreeMenuAction(id)) onAction(id)
              }}>
                {item.label}
              </Menu.Item>)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
