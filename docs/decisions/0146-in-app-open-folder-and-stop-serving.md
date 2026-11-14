# 0146: In-app Open folder, unreadable folders, and Stop serving

- Status: Accepted
- Date: 2026-11-15
- Supersedes: [0061](0061-daemon-roots-and-leases.md)'s "There is no root
  removal" and its missing saved roots being skipped and kept;
  [0081](0081-desktop-bridge-v2-native-features.md)'s `openFolder`
- Amends: [0009](0009-multiple-roots-and-worktree-picker.md)'s Browse,
  [0052](0052-welcome-tab-and-contextual-empty-state.md)'s Open folder entry,
  [0067](0067-desktop-shell-and-protocol-proxy.md)'s navigation policy

## Context

The desktop app's Open Folder showed a native dialog, then asked the daemon to
serve the chosen folder. On macOS the dialog grants the app access to the
folder, not the separate `zero` daemon that reads it: the daemon got `EPERM`
for `~/Downloads` and similar folders, yet added and saved the root. Every
surface then showed `read scan root: open …: operation not permitted`, and
nothing could undo it, since 0061 had no root removal. In the browser, after
`zero .` in a repository, the picker's Browse opened on "Repositories open
whole" and any other path said "No folders match": Open folder looked broken.
A native dialog also cannot pick a folder on a remote host.

## Decision

**The server browses its own disk.** When the server manages its roots (the
daemon, over its socket, TLS, or Tailscale), `ProjectsResponse.manageRoots` is
true and `GET /api/directories` lists any absolute path on its host; an empty
path is the home folder. Folders inside a repository answer "Repositories open
whole. Open <repo> instead." Each listed folder zero cannot read carries
`problem` and `problemCode`. Without `manageRoots` (`zero browser`, `zero
attach`), Browse stays within the served roots and the picker offers it only
when a served root is a plain folder.

**Opening a folder serves it.** `POST /api/roots {path}` (Origin and JSON
guards, 1 MiB) serves a folder the way `zero <path>` does and returns
`{root, added, replaced, project}`; the picker then opens the project. The
picker, the Welcome tab's Open folder…, and the desktop app's File › Open
Folder… (which dispatches `zero:open-folder` to the page) all use this one
flow, so local and remote windows behave alike. The native dialog and the
bridge's `openFolder` are gone.

**Unreadable folders are refused and explained.** Opening reads one entry of
the folder first. On macOS, `EPERM` is `privacyBlocked`: "macOS blocked zero
from reading <folder>. Allow <binary> in System Settings › Privacy & Security
› Full Disk Access, then try again." Other failures are `folderUnreadable`:
"zero can't read <folder>: <reason>." Nothing is served or saved. A served
root that becomes unreadable is listed with its problem, its page answers the
code (`PageData.errorCode`), and the document pane shows the message with Stop
serving <folder>, Choose another project, and, in a local desktop window, Open
Privacy Settings (`x-apple.systempreferences:`, which the desktop app opens
only from its local window on macOS).

**Stop serving.** `DELETE /api/roots?path=` stops serving a root, saved or
skipped, and saves the roots file; the picker's served-folder rows carry a
Stop serving action, without confirmation, since serving again is one Open
away. Stopping the current project's root lands on the next served project,
or on "No projects yet" with Open folder….

**Missing saved roots are dropped.** At start the daemon logs "no longer
serving missing root" and saves the file without it. Overlapping roots are
still skipped and kept.

`app.RootControl` (`Open`, `Remove`) is how the daemon's `Roots` lends root
changes to the application layer; `internal/app` knows no roots file.

## Consequences

- Anyone with a remote connection's token can list folder names on the host
  and serve any folder its user can read. The token already grants reading
  served files; this widens it to the host.
- macOS still blocks the daemon until the user allows the `zero` binary. A
  follow-up could run the daemon as a child of the app bundle so macOS asks
  on first access.
- Browse loses the native dialog's sidebar and recent places.
- Other windows on a stopped project show "Project unavailable".
- A root on an unmounted volume is forgotten at the next start.
