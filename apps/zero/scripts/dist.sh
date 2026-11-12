#!/bin/sh
# Builds install assets for this machine from the checked-out commit, for
# scripts/install-dev.sh (decision 0134). mise runs it after the frontend is
# built: `mise run dist` and `mise run dist:image`.
#
#   apps/zero/scripts/dist.sh assets   zero_<V>_<os>_<arch>.tar.gz and the
#                                      desktop package (package.sh) in
#                                      ZERO_DIST_OUT, named like release assets
#   apps/zero/scripts/dist.sh image    the local zero-dev:<V> image for the
#                                      Docker server's architecture, which zero
#                                      attach uses for development builds
#
# ZERO_DIST_VERSION and ZERO_DIST_OUT, and the output names, are install-dev.sh's
# contract with every ref it builds; keep them. Binaries are stamped as in
# .github/workflows/build.yml. Runs from the repository root.
set -eu

version="${ZERO_DIST_VERSION:?set ZERO_DIST_VERSION}"
commit="$(git rev-parse --short=12 HEAD)"
date="$(git show -s --format=%cI HEAD)"
module="github.com/flexdinesh/zero/internal/version"

# build GOOS GOARCH OUT builds the stamped zero binary.
build() {
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build \
    -trimpath \
    -ldflags="-s -w -X ${module}.Version=${version} -X ${module}.Commit=${commit} -X ${module}.Date=${date}" \
    -o "$3" \
    ./apps/zero
}

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

case "${1:-}" in
  assets)
    mkdir -p "${ZERO_DIST_OUT:?set ZERO_DIST_OUT}"
    out="$(cd "$ZERO_DIST_OUT" && pwd)"
    os="$(go env GOHOSTOS)"
    arch="$(go env GOHOSTARCH)"
    name="zero_${version}_${os}_${arch}"
    mkdir "$stage/$name"
    build "$os" "$arch" "$stage/$name/zero"
    cp README.md LICENSE "$stage/$name/"
    tar -C "$stage" -czf "$out/$name.tar.gz" "$name"
    # apps/desktop needs Go 1.27; GOTOOLCHAIN fetches it, as build.yml does.
    GOTOOLCHAIN=go1.27.3 apps/desktop/scripts/package.sh "$os" "$version" "$out" "$out" "$arch"
    ;;
  image)
    arch="$(docker version --format '{{.Server.Arch}}')"
    case "$arch" in
      amd64 | arm64) ;;
      *) echo "unsupported Docker architecture $arch: zero supports amd64 and arm64" >&2; exit 1 ;;
    esac
    build linux "$arch" "$stage/linux/$arch/zero"
    # apps/zero/Dockerfile copies <TARGETPLATFORM>/zero; the build arg covers
    # builders that do not set it.
    docker build \
      --platform "linux/$arch" \
      --build-arg "TARGETPLATFORM=linux/$arch" \
      --label "org.opencontainers.image.version=$version" \
      --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
      --file apps/zero/Dockerfile \
      --tag "zero-dev:$version" \
      "$stage"
    ;;
  *)
    echo "usage: apps/zero/scripts/dist.sh assets|image" >&2
    exit 2
    ;;
esac
