# 0136: Installs stop the running daemon

- Status: Accepted
- Date: 2026-11-12
- Extends: [0061](0061-daemon-roots-and-leases.md),
  [0101](0101-install-script-installs-cli-and-desktop.md),
  [0134](0134-dev-installs-build-from-source.md)

## Context

The daemon embeds the web app of the build that started it and serves it
until it exits, 30 idle minutes later (0061). Clients connect to any daemon
that speaks their protocol, whatever its release. So after an update, `zero`
and the desktop app could keep showing the old UI, and nothing said why: a
walkthrough could still draw its narration inline after 0135 was installed. Release
strings cannot tell the builds apart either, since every development build of
`main` reports `0.0.0-dev.main`.

## Decision

- `install.sh` and `install-dev.sh` stop a running daemon once the update is
  installed and recorded, with the CLI they just installed (`<name> daemon
  stop`), and report it. The next `zero` starts the new build's daemon. One
  shared block (`shared:daemon`) carries it.
- Any running daemon is stopped, not only an older one: versions cannot tell
  development builds apart.
- Stopping happens after the install, so a failed build or download leaves the
  running daemon alone.
- A failed stop only warns and names `<name> daemon stop`; the install stands.
- While the desktop app runs (only `install.sh --cli-only` installs then) the
  daemon is left running, with a warning to quit the app and stop it: the app
  would start its own daemon again at once.

## Consequences

- Browser tabs served by the daemon, and `--remote` or `--tailscale`
  exposures, end when an install finishes.
- `zero browser` processes serve their own copy and are not stopped.
