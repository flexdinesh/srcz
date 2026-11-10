# Releases

Zero ships only as GitHub release assets, installed with the scripts in
`scripts/` (decisions 0073, 0079). No branch or tag carries built files; tags
point at plain `main` commits. Homebrew and `go install` are not supported.

`.github/workflows/build.yml` builds every asset for one commit and version.
Two workflows call it:

- `release.yml`: pushing a `vX.Y.Z` tag publishes that stable release.
- `ci.yml` (**Edge**): every push to `main` replaces the `edge` prerelease.

## First Zero release: v0.2.0

Keep the `0.2` series in `.release-version`; the first Zero stable release is
**v0.2.0** (decision [0118](decisions/0118-zero-name-and-collision-safe-installs.md)).
The operator coordinates the repository rename to `flexdinesh/zero`, the stable
release, an edge build with Zero assets, and the site announcement. The website
domain and `sourcezero-docs` Cloudflare Worker stay unchanged. Implementation
and PR merge do not tag or publish a release or rename the repository.

Previously published releases remain immutable. Old releases carry `srcz`
asset names; the new installers require `zero_*` and `zero-desktop_*` assets.
Between cutover and their publication, stable or edge installation fails
clearly before changing either component. Publish v0.2.0 and complete the
Zero edge build before announcing those install commands as available.
Existing srcz installs and data remain untouched; Zero starts fresh.

## Stable releases

No repository secrets are needed; publishing uses the workflow's
`GITHUB_TOKEN`.

1. Merge release-ready code to `main`. Ordinary checks run locally before
   push; run `mise run check:full` before releasing for correctness and extended
   stress, resource, and compatibility validation.
2. Pick the tag: `go run ./tools/release-version` prints the next patch in
   the `.release-version` series (or the tag already on `HEAD`).
3. Tag a `main` commit and push the tag:

   ```sh
   git fetch origin
   git tag v0.2.0 origin/main
   git push origin v0.2.0
   ```

4. `check` rejects a tag that is not `vX.Y.Z` or whose commit is not on
   `main`, and skips the build when the release already exists.
5. `build` (`build.yml`):
   - `cli` builds the embedded frontend and the four Go archives stamped with
     the version, commit, and commit date, and smoke tests the linux/amd64
     binary.
   - `desktop-linux` (Ubuntu) and `desktop-macos` (macOS) package the desktop
     app per arch with `apps/desktop/scripts/package.sh`, bundling the matching
     archive's `zero`. Each smoke tests one package: Linux checks the amd64
     app's and bundled binary's versions, the desktop entry's `zero://`
     handler, and the icon; macOS checks the arm64 app's versions, its signature,
     and `CFBundleURLSchemes`.
   - `assets` checks the exact asset set and writes `checksums.txt`.
   - `image` copies the linux archives' binaries onto
     `gcr.io/distroless/static:nonroot` (`apps/zero/Dockerfile`) for amd64 and
     arm64, smoke tests the amd64 image, and uploads one OCI archive as the
     `image` artifact (not an asset).
6. `publish` creates the GitHub Release for the tag with generated notes and
   marks it latest.
7. `image` pushes that archive to `ghcr.io/flexdinesh/zero:<version>` and
   `:latest` with skopeo (decision 0125). ghcr creates the package private on
   its first push; make it public once in the package settings.

Published releases are never rebuilt or replaced: `check` and `publish` both
skip an existing release, so re-running failed jobs is safe. To redo a
release whose publish failed before the release existed, re-run the
workflow; to replace a published one, publish a new patch version.

## Edge prerelease

After every push to `main`, the **Edge** workflow runs `build.yml` with
version `0.0.0-edge` and `macos-arches: arm64` (no macOS Intel, decision 0093).
When every build job passes, `publish` moves the `edge`
tag to the pushed commit, creates or edits the `edge` release (prerelease,
never latest, notes name the commit), uploads the assets with `--clobber`
(same names every time, so each is replaced in place), and deletes assets
no longer built. A newer push cancels an older build; publishing is never
cancelled, and an older run skips publishing when `edge` already has a newer
commit. The first green push creates the prerelease. Each publish then pushes
the image to `ghcr.io/flexdinesh/zero:edge`.

Edge binaries report `zero 0.0.0-edge <commit> <date>`; the desktop app
reports `zero-desktop 0.0.0-edge <commit>`.

## Assets

Each release and `edge` publishes `checksums.txt`, four archives, and four
desktop packages, where `<version>` is the tag without its leading `v`, or
`0.0.0-edge`:

- `zero_<version>_<darwin|linux>_<amd64|arm64>.tar.gz`
- `zero-desktop_<version>_linux_<amd64|arm64>.tar.gz`
- `zero-desktop_<version>_darwin_<amd64|arm64>.zip`

`edge` omits every `darwin_amd64` asset (decision 0093); the edge install
scripts stop on macOS Intel and point at the stable ones.

The install scripts download these names:

| Script | Installs | From |
| --- | --- | --- |
| `install.sh` | CLI and desktop app; CLI alone with `--cli-only` | the release `releases/latest` redirects to |
| `install-edge.sh` | CLI and desktop app; CLI alone with `--cli-only` | `releases/download/edge/` |

These names are part of the installer contract. v0.1.6 and earlier have no
`zero_*` or `zero-desktop_*` assets. The new stable installer stops until
v0.2.0 publishes them; the new edge installer likewise requires a completed
Zero build. Missing assets never authorize falling back to old srcz binaries.

Each archive contains the native `zero` binary, README, and license. The
frontend is built into `apps/zero/internal/web/dist/` before Go
compilation and embedded in the binary. Node.js and pnpm are build-time
dependencies only; installed releases need no JavaScript runtime, external
assets, or sidecar server.

Desktop packages bundle the same Go binary as the archive for their OS and
arch, at `resources/bin/zero` (not on `PATH`). Linux needs WebKitGTK 4.1 on the
machine. macOS builds are ad-hoc signed, not notarized, so Gatekeeper blocks the
first launch of a browser-downloaded package until the user allows it. There is
no auto-update; upgrade by running the install script again. To package locally,
run `apps/desktop/scripts/package.sh` from the repository root with archives
from the `cli` job.

Stable and edge installers remember the exposed CLI name (`zero`, `zero-cli`,
or an explicit `--name NAME`) and verify managed paths before updates and
uninstall. Archives and the desktop's bundled binary always keep `zero`.
See [installation details](../apps/site/src/pages/docs/getting-started.mdx#command-name-collisions).

For development installs from `edge`, see the
[development guide](development.md#install-from-main).

The install scripts share code between `# shared:<name>:begin/end` markers;
edit every copy. `mise run test:release` runs shellcheck and
`tests/install-scripts.test.ts`, which checks the copies match and runs each
script against stub tools.

## Docs site deploy

The site (`apps/site`) deploys as plain static files through Cloudflare Workers
Static Assets and Workers Builds (decision 0103). `apps/site/wrangler.jsonc`
owns the Worker name and assets directory (`apps/site/dist/public`). Dashboard
settings:

| Setting | Value |
| --- | --- |
| Worker name | `sourcezero-docs` (must match `name` in `wrangler.jsonc`) |
| Root directory | repository root (CF reads `.node-version`, Node 26) |
| Build command | `pnpm install --frozen-lockfile --filter @zero/site... && pnpm build:site` |
| Deploy command | `npx wrangler deploy --config apps/site/wrangler.jsonc` |
| Build variables | `SKIP_DEPENDENCY_INSTALL=1`; `PNPM_VERSION=11.24.0` if the build image ignores `packageManager` |

The filtered install skips the web workspace. `pnpm build:site`
fails on dead internal links. `not_found_handling` serves `404.html` for unknown
paths.

## Version series

`.release-version` contains the active `major.minor` release series, which
`go run ./tools/release-version` reads. The current `0.2` series selects `v0.2.0`
when the series has no releases, then `v0.2.1`, `v0.2.2`, and so on; when a
release tag already names `HEAD`, it prints that tag.

To begin a new minor or major series, change `.release-version` in the repo.
Changing it to `0.3` makes the next release `v0.3.0`; changing it to `1.0`
makes the next release `v1.0.0`. Later releases continue incrementing that
series' patch number. The workflow accepts any `vX.Y.Z` tag on `main`; the
series only suggests the next one.
