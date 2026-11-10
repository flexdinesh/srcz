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

## Use

```sh
zero .            # open in the desktop app (falls back to the browser)
zero browser .    # always serve in the browser
zero . --remote   # serve to another machine; run the printed `zero connect ...` there
zero --help
```

## Docs

- [CLI](docs/cli.md)
- [User guides](apps/site/src/pages/docs)
- [Development](docs/development.md), [architecture](docs/architecture.md), [release](docs/release.md)
- Agent skill: `npx skills add flexdinesh/zero --skill zero-walkthrough`
- Feedback skill: `npx skills add flexdinesh/zero --skill zero-feedback`
