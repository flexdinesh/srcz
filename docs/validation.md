# Local validation

Use this machine for validation before PR creation and updates. All tests and
their prerequisite builds run in Docker Compose containers. Safe static checks run on the host
against private snapshots. Development commands and formatting stay on the host.
Linux test coverage qualifies; native macOS checks are optional supplements.
The edge prerelease and release workflows remain independent.

## Commands and PR workflow

While editing, targeted tasks capture immutable current edits and relevant
unignored new files. They exclude personal environment files, dependencies, and
generated outputs. Targeted results never qualify a PR, even when they pass.

```sh
mise run test:go
mise run test:race
mise run test:web
mise run test:release
mise run test:browser -- tests/browser/live-updates.spec.ts
mise run test:desktop
mise run test:desktop:e2e
mise run lint
mise run typecheck
mise run fmt:check
mise run tidy:check
mise run mise:check
mise run contracts:check
```

Before creating or updating a PR, commit changes and validate clean committed
HEAD across all ten correctness groups. Verify status immediately before the separate
push/PR operation:

```sh
mise run check:pr
mise run check:status
```

Confirm HEAD still matches the reported tested commit. Tracked changes or a
changed HEAD require reassessing validation before publication. `check:status`
compares relevant inputs with successful certificates; it runs no tests, builds,
or containers. Validation never creates or updates a PR. Local conventions
are bypassable; Git has no standard pre-PR hook and no remote enforcement is
introduced. There is no mandatory pre-push suite.

`check` and `validate` alias `check:pr`. Select a committed group
with `mise run check:pr -- --group docs`. Use `mise run check:pr -- --force` to
execute checks and prerequisite builds again. `mise run check:prune` manages
completed artifacts.

Run extended checks when the change affects performance, stress behavior,
resource use, or browser compatibility:

```sh
mise run check:extended       # stress, desktop RSS, Playwright WebKit
mise run check:full           # correctness plus extended
mise run check:status -- --suite extended
mise run test:browser:extended
mise run test:desktop:extended
```

Diff virtualization, large-document responsiveness, worker/process lifecycle,
memory, browser-engine dependencies, and desktop rendering changes warrant the
relevant extended checks. Ordinary copy or unrelated backend changes do not.
`--suite correctness|extended|full` selects aggregate validation/status coverage.
Extended groups have separate certificates; they cannot certify correctness.
Report extended failures even when correctness passes.

Public mise tasks invoke the coordinator. Hidden `_host:*` and `_container:*`
tasks contain leaf commands and never invoke public wrappers. This prevents
container execution from recursively launching the host coordinator.

| Group | Location | Coverage |
| --- | --- | --- |
| repo | Host | Go formatting, module tidy diff, mise validation, generated-contract drift (`contracts:check`) |
| web-static | Host | Web typecheck, oxlint, stylelint |
| tooling-static | Host | Root TypeScript check for scripts and tests |
| site-static | Host | Site TypeScript check |
| go | Container | Vet and one race-enabled Go test pass |
| frontend | Container | Frontend, mock-server, and fixture-contract tests |
| tooling | Container | Release, runner, and browser harness tests |
| docs | Container | Production site build and internal-link validation |
| browser | Container | Chromium integration tests and fixture servers (WebKit opt-in) |
| desktop | Container | Desktop app unit tests on Go 1.27, then the built app under Xvfb |

Extended groups: `browser-extended` (Chromium stress with the large diff
fixture), `desktop-extended` (RSS scenarios), and `webkit` (browser compatibility).
The correctness browser suite excludes `@extended` tests and uses compact
fixtures that retain hunk navigation and collapsed-gap reveal.

Go vet stays in a container because it needs the embedded frontend build. Tests of
architecture or validation tooling remain tests and run there too. Git, Ruby,
and repository-local TypeScript are prerequisites: missing tooling must fail
preparation rather than silently skip formula or navigation coverage.

### WebKit (opt-in)

`mise run test:browser:webkit` runs the browser suite on Playwright's WebKit
project. It reports UI compatibility with WebKit-based shells and Safari; it is
not part of `check:pr`; it is included in `check:extended`. The shared `browser`
image carries Chromium and WebKit with their system libraries, so this group
reuses the gate's image. Playwright's
WebKit tracks recent WebKit, so passing here is an upper bound: distribution
WebKitGTK builds can lag it.

### Desktop

The `desktop` group runs `mise run test:desktop` then `mise run test:desktop:e2e`
(decision 0095). `apps/desktop` is a Go 1.27 module outside `go.work`, so its
preparation installs the Go 1.27.3 tarball after checking its sha256, and the
leaf sets `GOROOT` to it (mise's points at the locked Go). The unit half runs
shellcheck on `apps/desktop/scripts`, `go mod tidy -diff`, `go vet`, and
`go test -race` with `GOWORK=off`.

The e2e half builds the app with `-tags e2e` (mygo's automation plugin) and drives
its page under Xvfb with WebKitGTK from the Debian snapshot, against the real
`srcz` binary with its web app embedded; screenshots and
`report.json` land in the artifact directory under `desktop-e2e/`. It also runs
`srcz <dir>` against a `srcz://` handler registered with real `xdg-utils`. Each
launch gets its own socket, roots file, and XDG directories; nothing reaches the
user's daemon. The group reads `apps/desktop/`, `apps/srcz/` (the module it
replaces and the binary it runs), `apps/web/`, and `packages/contracts/`.
`fmt:check` covers `apps/desktop`; `tidy:check` does not. Linux only: macOS is
built and smoke-tested by `build.yml`.

Correctness selects `TestWebViewApp`. `test:desktop:extended` selects only
`TestWebViewResources`, measuring a document session and a fresh single-document
profile. RSS files and their settling waits belong to extended artifacts.

## Containers and admission

Docker Engine with the Compose and buildx plugins is the only prerequisite
(decision 0110). There is no engine to provision. `tools/validate` builds
`tools/validate/Dockerfile` on the default builder and runs each group in its
own Compose project from `tools/validate/compose.yaml`, both taken from the
validated snapshot.

| Stage | Contents |
| --- | --- |
| `base` | Pinned Debian digest and snapshot; every apt package (common, desktop e2e, the locked Playwright's Debian 12 list); mise |
| `toolchain` | Locked go, node, and pnpm only |
| `node-deps`, `browsers` | Frozen pnpm install (store cache mount); Chromium and WebKit |
| `go-deps`, `desktop-deps` | Module downloads (cache mount, then an offline copy of the exact build list); Go 1.27.3 for `apps/desktop` |
| `source` | The group's inputs and a private baseline commit, before any build |
| `web`, `binary` | Embedded frontend and the srcz binary (Go build cache mount) |
| targets | `go`, `frontend`, `tooling`, `docs`, `browser` (also `browser-extended`, `webkit`), `desktop` (also `desktop-extended`) |

Build contexts are hardlink trees materialized from the group's fingerprinted
files: `ctx-src` is exactly those files and every other context is a filter of
them, so image inputs and certificate inputs cannot diverge. `web` and
`binary` read narrow contexts, so every group and worktree with matching build
inputs shares them. A Playwright bump that needs new system packages fails
`TestPlaywrightPackagesCoverLockedPlaywright` until `base` lists them.

Runners get 2 CPUs, 4 GiB, `init`, a 1 GiB `/dev/shm`, an internal network
with no egress, no published ports, no host network, and no Docker socket.
The only shared mutable state is the external Go build cache volume
`srcz-check-go-build`, which teardown never removes.

A run that executes a container group takes one of two slots in
`~/.cache/local-validation/slots`, shared with other repositories so the limit
stays machine-wide; host-only runs take none. It acquires input locks first,
then the slot, then sweeps that slot's leftovers. Up to three groups run at
once. Projects are named `srcz-check-s<slot>-<group>` and images
`srcz-check:s<slot>-<target>`. Each group writes `build.log` and `check.log`,
copies `/out` with `docker cp`, and is removed with `docker rm -f` and
`docker compose down -v` after success, failure, or cancellation. Image tags
are removed at run end; build cache stays for the next run. A failed group
lets the others finish: passing groups are certified and every failure is
reported.

Validation never prunes Docker images, build cache, or volumes, and never
touches other repositories' containers. These limits do not control unrelated
tools or guarantee freedom from host memory pressure.

## Source and execution isolation

Committed snapshots come from Git objects, preserving paths, modes, and safe
symlinks. Unsupported submodules and escaping symlinks fail. Never copy a
worktree's `.git` pointer. A separate synthetic baseline supplies tracked-file
enumeration and generated-file drift detection; Git behavior tests create their
own independent repositories.

The image prepares toolchains, frozen pnpm dependencies, Go modules,
frontend assets, and the application binary. Consumers receive private writable
container state. Go module preparation downloads the full dependency graph so
tidy and tests reuse transitive modules without downloading them per execution.
Browser clients, Vite, application servers, and mutable fixture
repositories run together inside the execution container. Mutating browser
tests retain their own fixtures. No application ports are published, and runners
receive no host networking, host-service tunnels, egress, or host Docker socket.
A future service container belongs in the group's Compose project, on tmpfs,
with no published ports.

Host static checks also use private materialized snapshots under
`.dev/validation/`. Their home, temporary, output, and dependency state is
worktree-local. Frozen dependency preparation is published atomically and copied
without shared writable hardlinks. Formatting remains an explicit operation on
the working tree; do not format concurrently with validation of that checkout.

Both environments allowlist behavior inputs. Personal configuration, host
service URLs, `.env`, and existing build outputs do not enter validation.

## Inputs, reuse, and certificates

Each group receives a conservative source subset. Go/browser consume embedded
UI inputs; frontend tests also consume API/family fixtures and the walkthrough
schema. Shared workspace locks invalidate their consumers. Site content does
not invalidate application tests. Toolchain preparation is separate from task
commands, so unchanged toolchains can survive a task edit.

Desktop keeps the replaced srcz module's test files: `go mod tidy` follows
dependency test imports when checking its sums. The standalone application
binary still excludes Go test files from its build inputs.

Input identities include relevant contents, paths, modes, symlinks, manifests,
locks, patches, configuration, implementation, toolchain/image/browser identity,
platform, arguments, and behavior-affecting environment. Host static certificates
are platform-specific. Commit and branch names record provenance, not validity.
A history-only rebase can reuse matching certificates; relevant upstream changes
invalidate affected groups. No elapsed-time or small-diff rule establishes success.

BuildKit caches image stages across groups and worktrees. Persistent Go
compilation caches (a build cache mount for the binary, the
`srcz-check-go-build` volume for checks) retain unchanged packages across source
edits and compatible binary/test builds. Frozen pnpm installs and module
downloads reuse cache mounts when a lockfile changes. Compilation and download
caches never substitute for successful test evidence. Debian packages also keep
archive and list cache mounts, named for the pinned snapshot: a step that fails on a
mirror error fetches only what is missing on the next attempt, and apt verifies
each cached package against the snapshot's signed indexes. `apt-get update` and
a package not yet cached still need the mirror. Local certificates record
successful complete check coverage. A per-input execution lock coordinates
concurrent certification and rechecks reuse before doing work. Starting a real
rerun invalidates old success and marks the input pending. Only completed checks,
drift detection, and artifact export publish a new certificate. Failure or active
cancellation leaves that input uncertified until a successful rerun. Cancellation
while waiting does not revoke prior proof. Older concurrent work cannot restore
stale success.

`--force` bypasses certificates, rebuilds the `source`, `web`, `binary`, and
group target stages, and reruns checks; Go tests use `-count=1`. Base,
toolchain, dependency stages, and compiler caches remain reusable. Reusable build
outputs are not successful test evidence. Aggregate success requires every
complete group plus a final cancellation, HEAD, and tracked-cleanliness check.

## Failures, artifacts, and debugging

Each invocation records HEAD/tree or current-edit provenance, input identities,
environment, coverage, execution/reuse, result status, and artifact locations.
Logs use unique run directories, not a shared directory cleared by another run.
Read the reported failure log and use the printed targeted rerun command.
Browser traces, screenshots, and useful failure fixtures survive failed checks.

SIGINT/SIGTERM stops only owned process groups, using TERM then bounded KILL,
then removes the invocation's own Compose projects. Graceful cleanup attempts
artifact export; hard termination may leave containers, which the next run in
that slot sweeps, and incomplete records, never certified success. Each group's
`build.log` shows which image stages were `CACHED`.

`check:prune` defaults to 30 days and 10 GiB of artifacts per worktree, removing
oldest completed runs first. Active-run locks protect live output; PID guesses
are insufficient. Compact certificates remain independent of artifact retention.

Linux tests do not establish macOS kqueue, filesystem, process, or browser
coverage. Native checks are optional, explicitly chosen supplements for those
concerns. Routine testing stays in containers. Container paths and retained traces
replace reliance on host-local fixture servers during debugging.
