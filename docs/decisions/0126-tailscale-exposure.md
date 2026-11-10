# 0126: Tailscale exposure

- Status: Accepted
- Date: 2026-11-11
- Extends: [0098](0098-remote-connections.md) remote connections, [0125](0125-docker-image-and-foreground-remote.md) daemon lifetime

## Context

`zero <path> --remote` (0098) serves the daemon over pinned TLS with a token,
and the desktop app connects with the printed string. On a tailnet the network
already authenticates every peer and Tailscale issues real certificates for
each machine's MagicDNS name, so a browser on any tailnet device could open
zero without a string or a certificate warning. Later the desktop app should
find zero servers on tailnet peers itself. Both need the daemon, not a second
server, to answer the tailnet.

`tsnet` (an embedded Tailscale node) was rejected: it adds megabytes and RSS
to every zero for an option few use, and a second node identity per machine.

## Decision

- **Exposure seam.** `internal/daemon` serves beyond its socket through an
  `Exposure` (Status, Start, Stop): `tls` is the 0098 listener, unchanged
  behind it, and `tailscale` is new. One serves at a time: starting one stops
  the others once it serves. Each owns its listener and the 0098/0125 UI
  lifetime (`FirstWait`, `Grace`, presence streams); one closing on its own
  exits the daemon only when no exposure serves and nothing else is active.
  `DaemonRemoteRequest.Exposure` picks it (empty is `tls`), and
  `DaemonRemote.Exposure` reports it; `/_daemon/remote` and
  `zero remote status|stop` cover both. `rotate` is TLS only.
- **`zero <path> --tailscale`** opens the paths in the daemon and starts the
  Tailscale exposure. It asks `tailscale status --json` for this machine's
  MagicDNS name, listens on a private `127.0.0.1` port, and runs
  `tailscale serve --https=<port> http://127.0.0.1:<private>` as the daemon's
  child, in the foreground: no `--bg`, so tailscaled drops the configuration
  when the child exits or the daemon stops, and nothing persists in the
  user's Tailscale settings. The HTTPS port is 7971 (zero's first default
  port, where a peer looks) or `--port`. It prints
  `https://<machine>.<tailnet>.ts.net:<port>/`. `--tailscale` excludes
  `--remote`, `--host`, and `--web`; `--foreground` works with it (0125).
- **`internal/tailscale`** is a small client over the `tailscale` CLI (PATH,
  then the macOS app's bundled CLI): `Status` and `Serve`. It knows no web app
  or daemon, and its errors name their fix: not installed, not running, not
  connected (`tailscale up`), HTTPS certificates off for the tailnet (admin
  DNS page), and, on Linux, `sudo tailscale set --operator=$USER`. Serving
  starts when the CLI prints `Available within your tailnet`, within 30 s.
- **HostPolicy.** `internal/web` answers a Host only by policy: localhost and
  IP literals always, plus a listener's explicit `AllowedHosts`. The socket,
  `zero browser`, and the TLS listener (which rewrites Host after the token)
  allow no names; only the Tailscale listener allows this machine's MagicDNS
  name, which `tailscale serve` forwards as the request's Host. DNS rebinding
  stays refused everywhere. The walkthrough and feedback write guards compare
  Origin with that Host, so `https://<name>:<port>` writes pass on the
  Tailscale listener and nowhere else.
- **Access is tailnet-wide, per ACL.** Anyone the tailnet's access rules let
  reach this machine can read and write what zero serves, as with a token
  holder over TLS. There is no zero token. `/_zero/remote` answers
  `contract.RemoteInfo` without one, behind the Host policy. The control API
  stays on the socket.
- **Loopback, not a Unix socket.** `tailscale serve` accepts a `unix:` target
  (Linux, macOS, BSD), and tailscaled would reach a socket in the daemon's
  0700 directory, but tailscaled lets only root serve a Unix socket. The
  daemon runs as the user, so the target is a TCP port on `127.0.0.1`. Other
  users of this machine can connect to it, as they can to `zero browser`; the
  Host policy does not stop them, since they can send any Host. For a TCP
  target serve forwards the client's Host (for a Unix socket it sends
  `localhost`) and adds `X-Forwarded-*` and `Tailscale-User-*`; zero reads
  none of them. Verified from Tailscale's source and documentation
  (`ipn/serve.go`, `ipn/ipnlocal/serve.go`, `cmd/tailscale/cli/serve_v2.go`);
  no tailnet was available to run it end to end when this was written.

## Future

- A `tailscale` connection kind in `pkg/connection`: standard TLS against the
  ts.net certificate, the tailnet as authentication, no token. The desktop app
  opens it through its existing `Upstream`.
- Peer discovery: `internal/tailscale` grows peers in `Status`; the desktop
  app probes each peer's `https://<name>:7971/_zero/remote` for
  `contract.RemoteInfo` and lists the zero servers it finds. The daemon-owned
  exposure is what answers, so no second serving path is needed.

## Consequences

- Tailscale users get a real-certificate browser URL and no string to copy.
- One exposure at a time: starting `--tailscale` stops a `--remote` listener
  and its connected windows, and the reverse.
- A daemon killed without a chance to stop its child leaves `tailscale serve`
  proxying to a closed port until that child exits; its configuration is
  still foreground-only and never persists.
- A daemon older than this refuses `--tailscale`; the CLI asks to stop it.
