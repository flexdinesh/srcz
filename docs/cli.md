# CLI

Examples use the canonical `zero` command. If installed as `zero-cli` or with
`--name NAME`, substitute that name for `zero`. The desktop command remains
`zero-desktop`; protocols and data paths keep their canonical names. See
[installation](../apps/site/src/pages/docs/getting-started.mdx#command-name-collisions).

## Open

```sh
zero                      # current directory in the desktop app (browser if not installed)
zero ~/code/foo           # a directory
zero --path a --path b    # several directories
zero ./browser            # a directory named browser
zero --no-open .          # print the desktop URL, do not open it
```

## Browser

```sh
zero browser .                    # serve on localhost and open the browser
zero browser --no-open .          # serve, do not open the browser
zero browser --port 8080 .        # fixed port (0 asks the OS; default first free of 7971-7980)
zero browser --host 0.0.0.0 .     # bind another address (no authentication)
```

`--host` or `--port` on bare `zero` also serves in the browser.

## Scope

```sh
zero --depth 3 .          # project directory depth (default 5)
zero --scan-depth 4 ~/code   # depth to search for git repositories (default 10)
```

## Remote

```sh
zero ~/code/foo --remote          # on the server: serve over TLS, print a zero connect string
zero ~/code/foo --remote --web    # also print a browser link
zero --remote --host 10.0.0.5     # one address (default every interface)
zero . --remote --foreground      # serve from this process until stopped, as in a container
zero connect <string>             # on your computer: open it in the desktop app
zero connect --host localhost <string>   # through your own ssh -L tunnel
zero connect --no-open <string>   # save it and print the zero:// link
zero remote status                # print the state and the string again
zero remote stop                  # stop serving over TCP now
zero remote rotate                # new identity; old strings stop working
```

Bare `zero` on a machine with no UI prints this advice and exits.

## Attach

```sh
zero attach docker://web/src      # serve /src of running container web on 127.0.0.1
zero attach docker://web          # the container's working directory
zero attach --port 8080 --no-open docker://web/src
```

Needs `docker` (any context) and a writable `/tmp` in the container; no shell.

## Walkthroughs

```sh
zero walkthrough publish tour.json     # check and store a walkthrough
cat tour.json | zero walkthrough publish -
zero walkthrough publish --json --no-open tour.json
zero walkthrough schema                # print the JSON Schema
```

## Daemon

```sh
zero daemon status     # running daemon's roots and status (--json)
zero daemon stop       # stop it
```

## Other

```sh
zero --version
zero [command] --help
```
