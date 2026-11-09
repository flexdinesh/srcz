# 0118: Zero name and collision-safe installs

- Status: Accepted
- Date: 2026-11-10
- Supersedes: [0100](0100-rename-to-srcz.md)'s naming and one-time rewriting of historical records
- Revises: [0073](0073-install-scripts.md), [0101](0101-install-script-installs-cli-and-desktop.md)'s installer names, ownership, and arguments; [0104](0104-source-zero-logo.md)'s product wordmarks

## Decision

The product is **Zero**, the repository `flexdinesh/zero`, and the canonical
commands `zero` and `zero-desktop`. Modules, packages, paths, environment variables,
protocols, desktop identifiers, headers, bridge names, cookies, and storage keys
use zero. The website keeps its current domain and `sourcezero-docs` Worker.
The Z mark and styling stay; wordmarks and social image say Zero.

This is a clean break. No old command aliases, protocol aliases, or data migration
are provided. Existing srcz installations and their settings, roots, connections,
walkthroughs, identity, and browser state are left untouched. Zero starts fresh.
Historical decision records and filenames remain historical; this decision
supersedes their naming rather than rewriting them again.

Stable and edge installers resolve command names before changing installation
destinations. They prefer the remembered name, otherwise `zero`. Any unrelated
executable on PATH or occupied target path, including directories, non-executable
files, and dangling symlinks, is a collision. They offer available `zero-cli`
through `/dev/tty` with a default-no confirmation. Decline, EOF, unavailable
terminal, or an occupied alternate stops installation and prints how to rerun
with `--name NAME`. An explicit name is a validated executable basename and
never authorizes overwriting an unrelated path. Shell aliases and functions in
the invoking shell are outside a POSIX sh installer's visibility.

The installer records its managed paths and content fingerprints in Zero's
configuration directory. Updates and uninstall verify ownership; modified or
unrelated paths are retained and reported. A successful explicit name change
retires the previous owned command. The alternate changes only the PATH command,
not Zero's protocols, storage, or bundled binary. Local CLI help and actionable
instructions use the invoked name; version output keeps the canonical brand.
Public and cross-machine instructions use `zero` and explain substitution.

Both components are preflighted and downloaded before installation. Existing
`--cli-only`, user-local PATH-directory selection, and no-shell-rc-edit behavior
stay. Unrelated desktop launchers and app destinations cause a preflight error.

## Release and consequences

Keep the 0.2 release series. Publish the first Zero stable release, v0.2.0,
promptly after merge and coordinate the repository rename and site announcement.
Previously published releases remain immutable. Until Zero release assets exist,
new installers fail clearly without changing an installation. Edge likewise
requires a completed build carrying Zero assets. Repository rename, release tags,
and publication are separate operator actions from implementation and PR merge.

Old connection strings and saved srcz data do not carry across. Both installs may
coexist until the user removes the old one. Installer-owned updates need no
collision prompt; unmanaged copies require choosing an available name.
