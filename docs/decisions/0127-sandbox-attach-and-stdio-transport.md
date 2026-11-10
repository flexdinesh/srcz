# 0127: `zero attach` to sandboxes, over a stdio transport

- Status: Accepted
- Date: 2026-11-11
- Extends: [0098](0098-remote-connections.md) (a third `Endpoint`, `Exec`),
  [0080](0080-application-layer-contracts-and-transports.md) (another
  transport over the same web app)
- Relates to: [0095](0095-desktop-app-is-mygo-electron-removed.md) (ssh stays
  unported; this is the wire it would use)

## Context

Code often lives in a running container: a dev container, a Compose service,
an agent's sandbox. Zero runs beside the files, so it has to run in there.
Such containers often have no shell, no package manager, a nonroot user, and
no published port. `zero <path> --remote` needs a port the host can reach and
a zero already installed. Other sandboxes (Podman, Kubernetes, hosted ones)
share the shape: a way to put a file in and run a command with its standard
input and output attached.

## Decision

**Command.** `zero attach docker://<container>[/path]` installs zero in a
running container, runs it there, and serves it to a browser on
`127.0.0.1` (`--port`, `--no-open`, as `zero browser`). Without a path it
serves the container's working directory. Ctrl-C stops it. Browser only for
now; the desktop app follows with saved sandbox connections.

**Stdio wire.** `zero serve-stdio <path>` (hidden) serves the web app on its
standard input and output: HTTP/2 without TLS, with prior knowledge (Go's
`net/http` unencrypted HTTP/2; no new module). One connection carries every
request and event stream. It answers `contract.RemoteInfoPath` (protocol,
version, host name) like a TCP server. It has no idle timeout and no token:
the pipe belongs to two processes. It exits at the end of its input, and then
deletes its own binary only when it runs from `/tmp/.zero`. Nothing else may
write to its standard output. `internal/stdio` owns serving and knows no
process or sandbox.

**`Exec` endpoint.** `pkg/connection.Exec{Argv, Env}` is an `Endpoint` whose
transport starts the command on first use, speaks the wire over its pipes,
checks `RemoteInfo` before any request, and starts it again on the next
request after it exits. `Close` ends its input and kills it 5 s later. A
failure to start quotes the command's last standard error, so docker's own
message reaches the user. The desktop app can use it unchanged later, since it
imports only `pkg/*`.

**Sandboxes.** `internal/sandbox` defines `Environment` (`Platform`,
`Install(version)`, `Exec(argv, env)`) and `ParseTarget`, whose one switch
lists the providers: `docker` only. No registry. `internal/attach` is the
generic flow: check the platform (linux/amd64 or linux/arm64), install, and
return an `Exec` endpoint for `zero serve-stdio -- <path>` with `HOME` set to
zero's directory.

**Docker.** `internal/sandbox/docker` drives the `docker` CLI, so Docker
contexts and `DOCKER_HOST` apply. The platform comes from `docker inspect` of
the container's image. zero comes out of `ghcr.io/flexdinesh/zero:<version>`
(`edge` for any non-release build) for that platform through `docker create
--platform` and `docker cp`, then goes into `/tmp/.zero` with `docker cp
--archive`, which gives it to the container's user. It runs through `docker
exec --interactive` with no terminal. The container needs no shell, only a
writable `/tmp`. Errors name the fix: docker missing, no such container,
container stopped, image pull, no `/tmp` or a read-only one.

**Proxy.** `zero attach` forwards the browser to the `Exec` transport with
the browser's own `Host`, so the web app's Host check and same-origin guards
behave as under `zero browser`. Like `zero browser`, it is unauthenticated on
loopback.

## Consequences

- One connection per attach; the container may restart and the next request
  starts zero again, unless `/tmp` was wiped or another attach's exit removed
  the shared binary. Then run `zero attach` again.
- Attaching needs the image for zero's own version on ghcr.io (network). A
  `--binary` path for air-gapped hosts is later.
- ssh stays out of the desktop app (0095). `ssh <host> zero serve-stdio` is
  the same wire, so an ssh endpoint would be `Exec` with no new protocol.
- Podman, Kubernetes, and hosted sandboxes are each a new `Environment` and a
  case in `ParseTarget`.

## Testing

h2c round trips with an event stream over in-process pipes; the `Exec`
endpoint against a helper process (respawn, close, failure text);
`ParseTarget` tables; the attach flow over a fake `Environment`; the docker
provider and the whole `zero attach` command over a fake `docker` on `PATH`.
A real Docker smoke test attaches to a distroless (shell-less, nonroot)
container. It needs a locally built binary and runs only when asked; the
provider's `Image` field points it at a local image instead of ghcr.io:

```sh
mise run build:web
CGO_ENABLED=0 go build -o .dev/zero-smoke ./apps/zero
ZERO_DOCKER_SMOKE_BINARY=$PWD/.dev/zero-smoke go test ./apps/zero/internal/sandbox/docker -run Smoke
```
