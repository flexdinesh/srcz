<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark-dark.svg">
  <img src="docs/brand/mark-light.svg" alt="Zero logo" width="64" height="64">
</picture>

# Zero

Zero (`zero`) is the code viewer for the agentic era: browse files and review
what agents change. Read-only and lean: rendered Markdown, image previews, formatted
JSON/YAML/HTML/CSS/JavaScript, highlighted source, commit, branch, and range diffs,
commit search and file history, agent walkthroughs, review feedback threads agents answer, code navigation, and live updates. Desktop app, browser, or a
remote box served to your laptop.

## Install

macOS and Linux, no sudo, no runtime needed. Installs to `~/.local/bin` (or `~/bin`).

```sh
# CLI and desktop app (Linux needs WebKitGTK 4.1)
curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install.sh | sh
# CLI only
curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install.sh | sh -s -- --cli-only
# choose an unused CLI name
curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install.sh | sh -s -- --name my-zero
# uninstall everything (keeps user data)
curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/uninstall.sh | sh
```

The canonical command is `zero`. If it collides, the installer offers available
`zero-cli` through the terminal; without a terminal it stops and requires
`--name NAME`. Updates and uninstall remember the chosen name. Substitute it for
`zero` in commands below. See [installation details](apps/site/src/pages/docs/getting-started.mdx#command-name-collisions),
including the limit on detecting shell aliases and functions.

Run a script again to update. Existing srcz installs and data stay untouched;
Zero starts with fresh settings, tabs, roots, connections, and walkthroughs.
An alternate CLI name leaves the desktop app, protocols, and config names canonical.
Latest `main` builds: see [development](docs/development.md#install-from-main).

## Ways to run

### One project

```sh
zero .            # open in the desktop app (falls back to the browser)
```

Run it in a repository or any folder. When the repository has worktrees, click
the branch in the explorer header (or press → on its picker entry) to switch;
worktrees open wherever they live, even outside the served directory.

### Many repositories

```sh
zero ~/code                     # every git repository under ~/code
zero --path ~/code --path ~/oss # several directories
```

Zero finds repositories and their worktrees up to `--scan-depth` folders deep
(default 10) and lists them in the project picker (Cmd/Ctrl+O). Pick a
repository, then a worktree by branch.

### Another machine (LAN, VPN, Tailscale)

```sh
# on the host, over ssh is fine; it keeps serving after you log out
zero ~/code --remote
# on your computer: the line the host printed
zero connect 10.0.0.5:7971/<credential>
```

`zero connect` opens the host in its own desktop app window. The printed
addresses are a guess; any route to the port works:

```sh
zero connect --host mybox <string>       # a Tailscale MagicDNS name or other host name
ssh -L 7971:localhost:7971 mybox         # or tunnel the port yourself
zero connect --host localhost <string>
```

On the host, `zero remote status` prints the string again, `zero remote stop`
stops serving, and `zero remote rotate` invalidates old strings. The string is a
password: traffic is TLS pinned to it and every request carries its token.
`--web` also prints a browser link. See [remote hosts](apps/site/src/pages/docs/remote.mdx).

### Browser only

```sh
zero browser .    # serve on localhost and open the browser
```

`zero browser --host <address>` serves plain http with **no authentication**:
anyone who can reach the address can read the files. Prefer `--remote`.

### Docker

```sh
docker run --rm -p 127.0.0.1:7971:7971 -v "$PWD:$PWD" -w "$PWD" \
  --user "$(id -u):$(id -g)" ghcr.io/flexdinesh/zero
```

Open http://localhost:7971. The image (`latest`, `<version>`, or `edge`) runs
`zero browser`: plain http with no authentication. `127.0.0.1:` keeps the port
on this machine; `-p 7971:7971` would serve your files to every network the
host is on. The directory mounts at its own path because linked worktrees store
absolute host paths; run it from a directory that holds the repository and its
worktrees. `--user` reads files as you.

To serve to another machine over TLS, run the server in the foreground and keep
its identity in a config volume, so the string survives restarts:

```sh
mkdir -p ~/.config/zero-docker
docker run --rm -p 127.0.0.1:7971:7971 -v "$PWD:$PWD" -w "$PWD" \
  --user "$(id -u):$(id -g)" -v "$HOME/.config/zero-docker:/tmp/.config/zero" \
  ghcr.io/flexdinesh/zero . --remote --foreground
zero connect --host localhost <string>   # the printed string names the container's address
```

`--foreground` never stops on its own; `docker stop` ends it.

### Attach to a running container

```sh
zero attach docker://<container>/src   # browse /src in a running container
```

zero copies itself into the container's `/tmp/.zero` (no shell needed), serves
it on `127.0.0.1`, and removes the copy on Ctrl-C. See [remote hosts](apps/site/src/pages/docs/remote.mdx#containers).

`zero --help` lists every command; see the [CLI reference](docs/cli.md).

## Docs

- [CLI](docs/cli.md)
- [User guides](apps/site/src/pages/docs)
- [Development](docs/development.md), [architecture](docs/architecture.md), [release](docs/release.md)
- Agent skill: `npx skills add flexdinesh/zero --skill zero-walkthrough`
- Feedback skill: `npx skills add flexdinesh/zero --skill zero-feedback`
