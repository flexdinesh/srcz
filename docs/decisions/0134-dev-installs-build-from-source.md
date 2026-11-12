# 0134: Development installs build any branch or commit from source

- Status: Accepted
- Date: 2026-11-12
- Supersedes: [0079](0079-releases-edge-prerelease-and-install-scripts.md)
  edge (the `edge` prerelease, its tag, `ci.yml`, `install-edge.sh`),
  [0093](0093-no-macos-intel-on-edge.md)
- Revises: [0125](0125-docker-image-and-foreground-remote.md) (no `edge`
  image), [0127](0127-sandbox-attach-and-stdio-transport.md) (the image a
  development build attaches with), [0101](0101-install-script-installs-cli-and-desktop.md)
  (`--cli-only` is the stable script's only)

## Context

Every push to `main` built the full asset set, including a macOS runner, and
replaced the `edge` prerelease and the `ghcr.io/flexdinesh/zero:edge` image.
That installs only the newest green `main`, one CI run behind. Contributors
and maintainers want to install any branch, or a commit on one, without CI
building it. 0073 built `edge` on the target machine before 0079 dropped it
for slow builds, a full toolchain download, and few platforms; this decision
keeps that cost on developers only and caches it.

## Decision

- Two scripts: `install.sh` installs the stable release CI builds (unchanged,
  `--cli-only` stays there); `install-dev.sh` builds from source for
  developers and contributors, documented in `docs/development.md` only.
- `install-dev.sh [--ref REF] [--name NAME]`, `main` by default. REF is a
  branch on `origin` (`github.com/flexdinesh/zero`) or a commit SHA (7 to 40
  hex digits) reachable from an origin branch. Tags, other repositories, and
  forks are refused: GitHub serves fork commits through the parent
  repository, so a SHA must be on an origin branch (`for-each-ref --contains`).
  Local checkouts and uncommitted work are not installed.
- It needs git, mise, and jq and never installs them. It clones without file
  contents (`--filter=blob:none --no-checkout`) into a temporary directory,
  checks out the commit, and runs the ref's own `mise run dist`, trusting the
  clone's config for those commands only (`MISE_TRUSTED_CONFIG_PATHS`). The
  build steps live with each ref, so every ref builds with its own; a ref with
  no `dist` task predates this decision and is refused. mise, Go, and pnpm
  keep their caches; the clone is deleted.
- `mise run dist` (`apps/zero/scripts/dist.sh assets`) writes this machine's
  `zero_<V>_<os>_<arch>.tar.gz` and desktop package under the release asset
  names into `ZERO_DIST_OUT`, stamped as `build.yml` stamps releases.
  `ZERO_DIST_VERSION`, `ZERO_DIST_OUT`, and the names are the script's
  contract with every ref. The script installs them with the stable script's
  shared code (`shared:unpack` holds archive checks and unpacking; downloading
  stays in `shared:release`). The desktop app always installs.
- Versions: `0.0.0-dev.<branch>` (runs of characters outside
  `[0-9A-Za-z-]` become `-`, at most 64, an all-digit name gets `b-`), or
  `0.0.0-dev.g<sha12>` for a commit, then the commit and its date. They are
  valid semver prerelease versions and Docker tags.
- When Docker runs, `mise run dist:image` builds `zero-dev:<V>` for the Docker
  server's architecture from `apps/zero/Dockerfile`. `docker.ImageRef` maps a
  release to `ghcr.io/flexdinesh/zero:<V>` and any other version to
  `zero-dev:<V>` (`zero-dev:dev` when the version is no tag). Without Docker,
  attach is unavailable for that build. `uninstall.sh` lists `zero-dev` images
  and prints the removal command; it deletes none.
- `mise.lock` covers linux amd64 and arm64 and macOS arm64. pnpm ships no
  macOS Intel binary, so `install-dev.sh` stops on macOS Intel and points at
  `install.sh`.
- `ci.yml` and `install-edge.sh` are deleted, with no forwarder; `build.yml`
  loses `macos-arches` and always builds the stable set. The operator deletes
  the `edge` release, tag, and image once by hand.

## Consequences

- No runner time on pushes to `main`. A packaging break surfaces at release
  time or in a developer's install, not on the push.
- A first install downloads the toolchain and takes minutes; later ones
  reuse caches.
- Edge installs already on machines print hints naming `install-edge.sh`,
  which now 404s; rerun with `install-dev.sh` or `install.sh`.
- A headless Linux machine gets the desktop app too; it builds without
  WebKitGTK but needs it to run.
- The local image covers only Docker's own architecture; a container of the
  other one fails with a message naming `install-dev.sh`. Builds from
  `go run` have no image.
- `install-dev.sh` on `main` calls each ref's `dist`: changing its variables
  or output names breaks installs of older refs.
