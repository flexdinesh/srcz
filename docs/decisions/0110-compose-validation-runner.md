# 0110: Docker Compose validation runner

- Status: Accepted
- Date: 2026-11-09
- Supersedes: [0058](0058-local-dagger-validation.md)'s engine ownership, and
  the Dagger execution in [0059](0059-validation-execution-boundaries.md) and
  [0096](0096-correctness-and-extended-validation.md). Groups, suites, input
  selection, certificates, and host checks stay as decided there.

## Context

Container groups ran in Dagger on one dedicated, explicitly managed engine per
repository. Engines had to be provisioned by hand, their versions pinned across
CLI, SDK, and engine, and their ownership guarded against other repositories'
cleanup. Each run executed one group at a time and stopped at the first
failure, so a full check was serial and a single failure hid the others.

## Decision

Build one multi-stage image from `tools/validate/Dockerfile` with BuildKit on
the default Docker builder, and run each group in its own Docker Compose
project defined by `tools/validate/compose.yaml`. No engine exists.

- Stages: `base` (pinned image digest, Debian snapshot, every apt package
  including desktop e2e and the locked Playwright's Debian 12 list, which a
  test checks), `toolchain` (locked go, node, pnpm), dependency stages
  (`node-deps`, `browsers`, `go-deps`, `desktop-deps`, with cache mounts),
  `source` (group inputs and a private baseline commit before any build),
  `web` and `binary` (application builds with cache mounts), then one target
  per group.
- Build contexts are hardlink trees the runner materializes from the group's
  fingerprinted files: `ctx-src` is exactly those files, and every narrower
  context is a filter of them, so image inputs cannot diverge from certificate
  inputs. `web` and `binary` read narrow contexts and are shared by every group
  and worktree whose build inputs match.
- Runners: 2 CPUs, 4 GiB, `init`, an internal network (no egress, no host),
  no published ports, no host network, no Docker socket, and one external
  compiler cache volume (`srcz-check-go-build`) that teardown never removes.
- Names: projects `srcz-check-s<slot>-<group>`, images
  `srcz-check:s<slot>-<target>`. Runs remove their containers and networks
  (`docker rm -f`, `compose down -v`) after success, failure, and
  cancellation, untag their images at the end, and sweep their slot's
  leftovers after acquiring it.
- Admission: one of two global slots in `~/.cache/local-validation/slots`
  (shared with other repositories) per run that executes a container group;
  host-only runs need none. Up to three groups run in parallel. A failure lets
  the others finish; passing groups are certified and every failure reported.
- `--force` rebuilds `source`, `web`, `binary`, and the group target, and
  reruns checks; base, toolchain, and dependency stages stay cached.

## Consequences

- No engine to provision, upgrade, or protect; Docker with Compose and buildx
  is the only prerequisite.
- A full check runs up to three groups at once and reports every failure.
- Checks cannot fetch at run time: dependencies must be in the image.
- BuildKit's cache grows until Docker's builder garbage collection trims it.
- Old Dagger engines and volumes are left for their owners to remove.
