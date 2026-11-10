# 0128: Sandbox connections in the desktop app

- Status: Accepted
- Date: 2026-11-11
- Extends: [0127](0127-sandbox-attach-and-stdio-transport.md) (`zero attach`
  opens the desktop app), [0098](0098-remote-connections.md) (saved
  connections gain a kind; `s-` IDs beside `r-`)
- Relates to: [0094](0094-mygo-app-uses-web-views.md) (the app imports only
  `pkg/*`), [0068](0068-cli-opens-desktop-app-and-desktop-releases.md) (the
  CLI opens the app and falls back to a browser)

## Context

0127 serves a container's files to a browser while `zero attach` runs. The
desktop app shows the local daemon and saved remote servers, one window per
connection, through `pkg/connection` endpoints. A container needs the same:
a saved connection a `zero://` link can name, which the app reaches without
knowing Docker. Later kinds (a `tailscale` connection, discovered servers,
other sandbox providers, integration credentials) must fit the saved file
without another migration.

## Decision

**Saved connections are a tagged union.** `connections.json` version 2 gives
every entry an `id`, `kind`, `label`, and `addedAt`, and its kind's fields,
flat: `tls` (`hosts`, `port`, `credential`; every version 1 entry) and
`sandbox` (`provider`, `ref`, `path`). In Go, `Saved` has exactly one of `TLS`
or `Sandbox`. `List` reads versions 1 and 2; `Put` writes version 2. An entry of
a kind this build does not know is kept as written, so an older build's saves
keep a newer one's connections; it has no endpoint. A kind is switched in one
place in the model, `Saved.Endpoint(zero)`, and one in the app, the proxy's
failure wording. TLS-only helpers stay typed (`SavedTLS.Endpoint`, `Probe`).

**IDs.** A sandbox is `s-<12 hex>`: the first bytes of SHA-256 of its provider,
the engine that runs it (`docker info`'s ID), and its ID there (the container's
full ID). None is secret. `IsID` accepts `r-` and `s-`, so `zero://s-…/` links
parse, resolve, and open their own window like remote ones.

**`zero connection stdio <id>`** (hidden) is a sandbox's endpoint:
`Saved.Endpoint(zero)` returns `Exec{zero connection stdio <id>}`, with `zero`
the app's bundled binary. It looks the connection up, opens the sandbox
(`sandbox.Open(provider, ref)`, the one provider switch, which `ParseTarget`
shares), runs 0127's attach flow, and hands its standard input and output to
`docker exec`. Provider knowledge stays in the CLI; the app knows only `Exec`.
`zero serve-stdio` deletes its binary on exit, so every run installs it again:
a second window, a restarted container, or another attach's exit no longer
leaves the app without zero.

**The app.** A sandbox window shares one `ExecTransport` between its pages and
its notifier (`Connections.Endpoint`, `client.NewEndpoint`), so one zero runs
per window; closing the window ends it. The proxy treats it as any saved
server: same refused paths, header allowlist, Host, CSP, and event-stream
keepalive. A failure shows "start it and run `zero attach <target>` again"
with docker's message. Like remote windows, sandbox pages get no `openFolder`
or `revealPath`.

**`zero attach`.** Like bare `zero`, it opens the app: it installs and starts
zero once to check the sandbox (pulling the image), waits for that zero to
exit, saves the connection (label: the target), and opens `zero://s-…/`. It
then exits. `--no-open` saves and prints the link, as `zero connect --no-open`
does. `--browser`, `--port`, a machine with no UI, or an app that is missing or
does not open serve 0127's browser proxy instead, with a notice in the last
case.

**docker off PATH.** An app started from a desktop session gets a short PATH
(macOS: `/usr/bin:/bin:/usr/sbin:/sbin`). The docker provider looks on PATH,
then in `/usr/local/bin`, `/opt/homebrew/bin`, `~/.docker/bin`,
`~/.orbstack/bin`, and `~/.rd/bin`, and runs one found there with its directory
first on PATH, for its credential helpers.

## Consequences

- The app runs docker with its own environment: `docker context use` applies;
  `DOCKER_HOST` or `DOCKER_CONTEXT` set only in a shell do not.
- Builds that read only version 1 refuse a version 2 file. The app and the CLI
  install together; mismatched ones say which version they read.
- A recreated container is another ID: its old connection fails until
  `zero attach` saves the new one. Stale sandbox entries stay in the file, as
  remote ones do.
- One install per window open (a few docker calls); the image is cached after
  `zero attach`'s check.
- Podman, Kubernetes, and hosted sandboxes add a case to `sandbox.Open`; a
  `tailscale` or discovered kind adds a `Saved` variant and its endpoint.

## Testing

Store round trips per kind, the version 1 read and version 2 write, unknown
kinds kept, entries without a kind refused; `Saved.Endpoint` per kind;
`SandboxID` inputs; `zero://s-…/` links. `zero attach` saving and opening the
app, its browser fallbacks, and `--no-open`, over a fake docker; `zero
connection stdio` through `Exec`, installing on every run. The client parity
suite gains an `Exec` transport (the test binary relays its standard input and
output to the stdio wire). The desktop proxy serves a sandbox through a helper
process that speaks the wire: forwarding, a shared transport, `Drop`, event
streams with keepalives, refused control paths, and the gone-sandbox page.
