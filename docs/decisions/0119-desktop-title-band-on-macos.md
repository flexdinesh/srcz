# 0119: Themed desktop shell on macOS

- Status: Accepted
- Date: 2026-11-10
- Revises: [0095](0095-desktop-app-is-mygo-electron-removed.md) (the title band
  returns on macOS through mygo), [0081](0081-desktop-bridge-v2-native-features.md)
  (the bridge gains `setAppearance`), DESIGN.md "No app header"

## Context

The desktop window took the OS theme: a light macOS title bar over a dark Zero
workspace, native menus in the OS polarity, and a window background fixed to
the Zero slate canvas, so named themes flashed it while loading. The app read as
a page placed in a window, not as the window itself. VS Code's Electron shell
draws its title bar in its theme and sets the native theme source from it.

0075 drew such a band in Electron through `env(titlebar-area-*)`. 0095 dropped
it because WebKit lacks those values. mygo reports the same room through its own
CSS variables (`--mygo-titlebar-height`, `--mygo-titlebar-inset-left`,
`--mygo-titlebar-inset-right`) for a window with `TitleBarStyle: TitleBarHidden`,
and tells the app the page's `theme-color` (`Page.OnThemeColorChanged`), as its
docs recommend for tinting a window.

## Decision

- **macOS hides the native title bar** (`TitleBarHidden`). The traffic lights sit
  at (12, 8), centered in a 32px band. Linux and Windows keep their native title
  bar and the OS theme: their decorations differ per desktop (KWin, Hyprland, and
  Sway keep the compositor's bar under a hidden one), and custom window controls
  are not worth owning.
- **The page draws the band.** `--titlebar-height` is
  `var(--mygo-titlebar-height, 0px)`, so browsers, Linux, Windows, and full screen
  render nothing and need no detection. The band is `workspace-chrome` closed by a
  1px `border` hairline, matching the status bar, so the chrome frames the
  workspace top and bottom. It drags the window (`--app-region: drag`; a double
  click follows the macOS zoom preference) and shows the window title centered
  on the window in 12px `--font-chrome`, `text-secondary`, `text-muted` while the
  window is in the background, clipped clear of the traffic lights. The layout,
  present mode, and the drawer start below it. The proxy's own pages (crash,
  failures) draw a drag strip of the same height.
- **The window background follows the page's `theme-color`**, which `theme.ts`
  already sets to the applied theme's canvas. Only opaque colors count; a page
  with none gets the default canvas. On every platform: it shows only before the
  page paints and while resizing.
- **Native surfaces follow the theme's polarity on macOS.** The bridge gains
  `setAppearance(source)`: `"system"` while the theme follows the OS (Auto),
  else the theme's `"light"` or `"dark"`, sent whenever the applied theme changes,
  Color Theme previews included. The app calls `Theme.SetSource` with it, so the
  menu bar, context menus, and traffic lights match. The appearance is the
  app's, so the window in front decides: a window applies its own on focus. Other
  platforms remember it and apply nothing. Every connection's page may call it;
  anything but the three strings is refused.
- **Startup opens in the last look.** `appearance.json` (0600, in the app's user
  data) keeps each connection's last background and appearance. A window opens
  with its background, and the app starts in the local window's appearance before
  any page loads, so named themes no longer flash.

## Consequences

- An older remote Zero UI draws no band: on macOS the traffic lights cover the
  top-left of its sidebar header until the remote upgrades. Accepted, as in 0075.
- Windows with different themes (a remote connection's) share one native
  appearance: a background window shows the front window's until it is focused.
- The traffic light offset is tuned for 16px buttons. CI builds macOS but never
  runs it, so the centering is checked by hand.
- Linux keeps its GTK menu bar and native title bar; nothing changes there but
  the window background.
