# Local validation image (docs/validation.md). tools/validate builds one
# target per container group from named contexts it materializes from the
# group's fingerprinted inputs; nothing else enters the image. Stages share
# layers across groups and worktrees whenever their narrow inputs match.
#
# Contexts (ctx-* so they never shadow a stage): ctx-toolchain (reduced mise
# config from mise.lock), ctx-node (workspace manifests and patches), ctx-gomod
# (zero/tools modules), ctx-desktopmod (desktop modules), ctx-web (web build
# inputs), ctx-bin (zero binary inputs), ctx-src (all group inputs).
#
# Debian packages come from snapshot 20261031T000000Z, which also names the apt
# caches; change every occurrence together.

# The capture records the environment and the check's exit status, and fails a
# check that changes tracked files or leaves untracked ones. It always exits 0:
# the runner reads /out/status.json. Its own stage keeps edits from rebuilding
# toolchain and dependency layers; every target copies it in.
FROM scratch AS capture
COPY --chmod=0755 <<'EOF' /usr/local/bin/zero-check-capture
#!/usr/bin/env bash
set +e
{
  uname -sm
  cat /etc/os-release
  mise --version
  mise exec -- go version
  mise exec -- node --version
  mise exec -- pnpm --version
  # Not `pnpm exec`: its dependency check installs, which hangs offline.
  if [ -x node_modules/.bin/playwright ]; then mise exec -- node_modules/.bin/playwright --version; fi
  printf 'HOME=%s\nLANG=%s\nTZ=%s\nGOFLAGS=%s\nGOMAXPROCS=%s\nMISE_JOBS=%s\nGOCACHE=%s\n' "$HOME" "$LANG" "$TZ" "$GOFLAGS" "$GOMAXPROCS" "$MISE_JOBS" "$GOCACHE"
} > /out/environment.txt 2>&1
"$@" 2>&1 | tee /out/check.log
codes=("${PIPESTATUS[@]}")
status=${codes[0]}
if [ "$status" -eq 0 ] && [ "${codes[1]}" -ne 0 ]; then
  status=${codes[1]}
fi
if ! git diff --exit-code --quiet HEAD; then
  printf '\nValidation changed tracked source files.\n' >> /out/check.log
  git diff HEAD >> /out/check.log
  status=1
fi
untracked=$(git ls-files --others --exclude-standard)
if [ -n "$untracked" ]; then
  printf '\nValidation created unexpected source files:\n%s\n' "$untracked" >> /out/check.log
  status=1
fi
printf '{"exitCode":%s}\n' "$status" > /out/status.json
exit 0
EOF

FROM debian:bookworm-slim@sha256:a3bba7dc7dbcc1f37c2856c51fc9a7fac96608f50cb87b1b4e4d8b8c85ae988e AS base
ENV HOME=/home/runner \
    XDG_CACHE_HOME=/home/runner/.cache \
    XDG_CONFIG_HOME=/home/runner/.config \
    XDG_DATA_HOME=/home/runner/.local/share \
    TMPDIR=/tmp \
    LANG=C.UTF-8 \
    TZ=UTC \
    CI=1 \
    GOMAXPROCS=2 \
    GOFLAGS="-p=2 -buildvcs=false" \
    GOTOOLCHAIN=local \
    GOPATH=/home/runner/go \
    GOCACHE=/home/runner/.cache/go-build \
    MISE_JOBS=2 \
    MISE_YES=1 \
    MISE_TRUSTED_CONFIG_PATHS=/src \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_AUTHOR_DATE=2000-01-01T00:00:00Z \
    GIT_COMMITTER_DATE=2000-01-01T00:00:00Z
# Every apt package lives here, optional groups included, so one base serves
# all targets. The archive and list caches only speed a rebuild; apt verifies
# cached packages against the snapshot's signed indexes.
#   common: TLS, git baseline, shellcheck, cgo for -race, archive tools
#   desktop e2e: display, session bus, GTK 3, WebKitGTK 4.1, Mesa, xdotool, xdg-utils
#   playwright: tools, chromium, and webkit lists for debian12-x64 of the
#   locked Playwright (TestPlaywrightPackagesCoverLockedPlaywright guards it)
RUN --mount=type=cache,id=zero-check-apt-archives-20261031T000000Z,target=/var/cache/apt/archives,sharing=locked \
    --mount=type=cache,id=zero-check-apt-lists-20261031T000000Z,target=/var/lib/apt/lists,sharing=locked <<'EOF'
set -eu
mkdir -p /home/runner /out/logs /src
rm -f /etc/apt/sources.list.d/debian.sources /etc/apt/apt.conf.d/docker-clean
printf '%s\n' 'Acquire::Retries "5";' 'Acquire::http::Timeout "30";' 'Dir::Cache::pkgcache "";' 'Dir::Cache::srcpkgcache "";' > /etc/apt/apt.conf.d/80zero-validation
printf '%s\n' \
  'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261031T000000Z bookworm main' \
  'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261031T000000Z bookworm-updates main' \
  'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261031T000000Z bookworm-security main' > /etc/apt/sources.list
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git shellcheck gcc libc6-dev xz-utils unzip \
  xvfb xauth dbus dbus-x11 libgtk-3-0 libwebkit2gtk-4.1-0 libepoxy0 libegl1 libegl-mesa0 libgl1-mesa-dri libglx-mesa0 \
  xdotool xdg-utils fonts-dejavu-core \
  fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-scalable fonts-liberation \
  fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
  libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
  libxfixes3 libxkbcommon0 libxrandr2 \
  libsoup-3.0-0 gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  libegl1 libenchant-2-2 libevdev2 libgdk-pixbuf-2.0-0 libgles2 libglx0 libgstreamer-gl1.0-0 \
  libgstreamer-plugins-base1.0-0 libgstreamer1.0-0 libgtk-4-1 libgudev-1.0-0 libharfbuzz-icu0 libharfbuzz0b \
  libhyphen0 libicu72 libjpeg62-turbo liblcms2-2 libmanette-0.2-0 libnotify4 libopengl0 libopenjp2-7 libopus0 \
  libpng16-16 libproxy1v5 libsecret-1-0 libwayland-client0 libwayland-egl1 libwayland-server0 libwebp7 \
  libwebpdemux2 libwoff1 libxml2 libxslt1.1 libatomic1 libevent-2.1-7 libavif15
curl -fsSL https://github.com/jdx/mise/releases/download/v2026.10.18/mise-v2026.10.18-linux-x64.tar.xz -o /tmp/mise.tar.xz
printf '%s\n' 'f4fbb6c4d89648f789b8d909e95ae52de941b085f7a8f14bab233dabf406ef02  /tmp/mise.tar.xz' | sha256sum -c -
tar -xJf /tmp/mise.tar.xz -C /tmp
install /tmp/mise/bin/mise /usr/local/bin/mise
rm -rf /tmp/mise /tmp/mise.tar.xz
EOF
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/zero-check-capture"]

# Locked go, node, and pnpm only: task edits in mise.toml keep this layer.
FROM base AS toolchain
COPY --from=ctx-toolchain . /src/
RUN MISE_JOBS=1 mise install go node pnpm

# Frozen workspace install. Packages are copied out of the shared store so the
# layer owns them. The store mounts at pnpm's default path: node_modules records
# it, and a different runtime store makes pnpm recreate node_modules offline.
FROM toolchain AS node-deps
COPY --from=ctx-node . /src/
RUN --mount=type=cache,id=zero-check-pnpm-store,target=/home/runner/.local/share/pnpm/store \
    mise exec -- pnpm install --frozen-lockfile --package-import-method=copy

# Playwright picks browser builds from the locked version.
FROM node-deps AS browsers
RUN mise exec -- pnpm exec playwright install chromium webkit

# Module downloads fill a shared cache (retried: the checksum database drops
# streams now and then), then a second, offline pass copies the exact build
# list into the layer (sums still checked against go.sum).
FROM toolchain AS go-deps
COPY --from=ctx-gomod . /src/
RUN --mount=type=cache,id=zero-check-go-mod,target=/cache/go-mod <<'EOF'
set -eu
for attempt in 1 2 3; do GOMODCACHE=/cache/go-mod mise exec -- go mod download all && break; [ "$attempt" -lt 3 ] && sleep 5 || exit 1; done
GOMODCACHE=/home/runner/go/pkg/mod GOPROXY=file:///cache/go-mod/cache/download GOSUMDB=off mise exec -- go mod download all
EOF

# apps/desktop is its own Go 1.27 module outside go.work (mygo v0.7.4).
FROM toolchain AS desktop-deps
ENV GOWORK=off ZERO_DESKTOP_GOROOT=/usr/local/go1.27
RUN <<'EOF'
set -eu
curl -fsSL https://go.dev/dl/go1.27.3.linux-amd64.tar.gz -o /tmp/go.tar.gz
printf '%s\n' '65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40  /tmp/go.tar.gz' | sha256sum -c -
mkdir -p /usr/local/go1.27
tar -xzf /tmp/go.tar.gz -C /usr/local/go1.27 --strip-components=1
rm /tmp/go.tar.gz
/usr/local/go1.27/bin/go version
EOF
COPY --from=ctx-desktopmod . /src/
RUN --mount=type=cache,id=zero-check-go-mod,target=/cache/go-mod <<'EOF'
set -eu
export GOROOT=/usr/local/go1.27
for attempt in 1 2 3; do GOMODCACHE=/cache/go-mod /usr/local/go1.27/bin/go -C apps/desktop mod download all && break; [ "$attempt" -lt 3 ] && sleep 5 || exit 1; done
GOMODCACHE=/home/runner/go/pkg/mod GOPROXY=file:///cache/go-mod/cache/download GOSUMDB=off /usr/local/go1.27/bin/go -C apps/desktop mod download all
EOF

# The group's inputs and its private baseline commit, before any build output.
FROM base AS source
COPY --from=ctx-src . /src/
RUN git init -q && git add --force --all && git -c user.name=validation -c user.email=validation@example.invalid commit -qm baseline

FROM node-deps AS web
COPY --from=ctx-web . /src/
RUN mise run --force build:web

FROM go-deps AS binary
COPY --from=ctx-bin . /src/
COPY --from=web /src/apps/zero/internal/web/dist /src/apps/zero/internal/web/dist
RUN --mount=type=cache,id=zero-check-go-build,target=/home/runner/.cache/go-build \
    mise exec -- go build -buildvcs=false -o /out/zero ./apps/zero

# Group targets. Runtime caches mount from compose.yaml.
FROM node-deps AS go
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=go-deps /home/runner/go/pkg/mod /home/runner/go/pkg/mod
COPY --from=source /src /src
COPY --from=web /src/apps/zero/internal/web/dist /src/apps/zero/internal/web/dist

FROM node-deps AS frontend
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=source /src /src

FROM node-deps AS tooling
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=source /src /src

FROM node-deps AS docs
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=source /src /src

FROM browsers AS browser
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=source /src /src
COPY --from=web /src/apps/zero/internal/web/dist /src/apps/zero/internal/web/dist
COPY --from=binary /out/zero /opt/zero
ENV ZERO_BROWSER_BINARY=/opt/zero \
    ZERO_BROWSER_ISOLATED=1 \
    ZERO_BROWSER_ARTIFACT_DIR=/out/fixtures \
    ZERO_BROWSER_OUTPUT_DIR=/out/playwright \
    PORT=18090 \
    ZERO_BROWSER_WEB_PORT=15183

FROM desktop-deps AS desktop
COPY --from=capture /usr/local/bin/zero-check-capture /usr/local/bin/zero-check-capture
COPY --from=source /src /src
COPY --from=binary /out/zero /opt/zero
ENV ZERO_DESKTOP_BINARY=/opt/zero
