# 0125: Docker image and foreground remote

- Status: Accepted; `edge` image removed by [0134](0134-dev-installs-build-from-source.md)
- Date: 2026-11-11
- Extends: [0061](0061-daemon-roots-and-leases.md) daemon lifetime, [0079](0079-releases-edge-prerelease-and-install-scripts.md) release assets, [0098](0098-remote-connections.md) remote connections

## Context

People want to run zero where it is not installed: a container beside the
code, or a machine whose processes a container runtime or service manager
owns. `zero <path> --remote` detaches a daemon that stops itself 10 minutes
before a first UI and 5 minutes after the last (0098), and the daemon exits
after 30 idle minutes (0061). In a container the detached daemon outlives the
foreground process, which exits at once, so the container stops; its own
timers would stop it again later.

## Decision

- `zero <path> --remote --foreground` runs the daemon in the command's process
  instead of detaching one. It takes the same socket, roots file, and
  identity, so `zero remote status|stop|rotate` and other clients reach it. A
  daemon already serving the socket is an error, never reused. It prints the
  connect string as `--remote` does and serves until SIGINT or SIGTERM, then
  shuts down as the daemon does. `--foreground` without `--remote` is
  rejected.
- `daemon.Lifetime` (`IdleExit`, `FirstWait`, `Grace`) is the daemon's one
  stopping policy; a zero duration never stops. `DefaultLifetime()` is the
  0061/0098 timing that `zero daemon run` uses; `--foreground` uses
  `Lifetime{}`. A remote start that names no waits takes the daemon's.
- `ghcr.io/flexdinesh/zero` is the CLI image: the release archives' static
  linux binary on `gcr.io/distroless/static:nonroot`, nothing compiled in
  Docker (`apps/zero/Dockerfile`). `ENTRYPOINT ["/zero"]`, `WORKDIR /src`,
  `CMD ["browser","--host","0.0.0.0","--port","7971","--no-open","."]`,
  `EXPOSE 7971`, and `HOME=/tmp`, so any `--user` can write its cache and
  config (a uid with no passwd entry otherwise gets `HOME=/`).
- `build.yml` builds the image for amd64 and arm64 from the archives it
  already makes, smoke tests amd64, and uploads one OCI archive as the `image`
  artifact, outside the `assets-*` set. `release.yml` pushes `<version>` and
  `latest` after the release publishes; `ci.yml` pushes `edge` in the edge
  publish job, only when that run published, so an older build never replaces
  a newer image. skopeo pushes the archive with the workflow token
  (`packages: write`).
- The documented run binds `127.0.0.1:7971`: browser mode has no
  authentication, and `-p 7971:7971` would publish it on every host interface.
  It mounts the directory at its own path, because linked worktrees store
  absolute host paths.

## Consequences

- Containers and service managers own the server's lifetime; nothing stops it
  behind them.
- The remote recipe needs a config volume (`/tmp/.config/zero`) to keep one
  connect string across restarts, and `zero connect --host localhost`, since
  the printed address is the container's.
- ghcr creates the package private on its first push; a maintainer makes it
  public once.
- A future exposure (Tailscale) and long-lived hosted servers reuse
  `Lifetime`.
