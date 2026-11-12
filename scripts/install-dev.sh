#!/bin/sh
# Installs the zero CLI and desktop app built from source: any branch of
# github.com/flexdinesh/zero, or a commit on one, main by default. For
# developers and contributors; stable installs use scripts/install.sh.
# Decision 0134.
#
#   curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install-dev.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install-dev.sh | sh -s -- --ref feat/x
#   curl -fsSL https://raw.githubusercontent.com/flexdinesh/zero/main/scripts/install-dev.sh | sh -s -- --ref 1a2b3c4d
#
# Needs git, mise, and jq; never installs them. The ref's own `mise run dist`
# builds it (mise.lock's toolchain; mise, Go, and pnpm keep their caches), and
# `mise run dist:image` builds the zero-dev image zero attach uses when Docker
# runs. Builds report 0.0.0-dev.<branch> (0.0.0-dev.g<commit> for a commit),
# the commit, and its date. Installs in the same places as scripts/install.sh
# and replaces either install, then stops a running daemon so the next zero
# serves this build (decision 0136). Remove with scripts/uninstall.sh.

# shared:base:begin
set -eu

REPO="flexdinesh/zero"

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  RED=""
  RESET=""
fi

step() { printf ' %s>%s %s\n' "$YELLOW" "$RESET" "$1"; }
ok() { printf ' %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf ' %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() {
  printf ' %s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
  exit 1
}
note() { printf '     %s%s%s\n' "$BOLD" "$1" "$RESET"; }
has() { command -v "$1" >/dev/null 2>&1; }

[ -n "${HOME:-}" ] || fail "HOME is not set"

detect_platform() {
  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    *) fail "unsupported OS $(uname -s): zero supports macOS and Linux" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=amd64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) fail "unsupported architecture $(uname -m): zero supports amd64 and arm64" ;;
  esac
}

# fetch URL OUT downloads URL to OUT.
fetch() {
  if has curl; then
    curl -fsSL --retry 2 --connect-timeout 10 -o "$2" "$1"
  elif has wget; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

TMP=""
cleanup() {
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
}
make_tmp() {
  TMP="$(mktemp -d 2>/dev/null || mktemp -d -t zero)"
  trap cleanup EXIT
  trap 'exit 130' INT TERM
}
# shared:base:end

# shared:desktop:begin
DESKTOP_DATA="${XDG_DATA_HOME:-}"
case "$DESKTOP_DATA" in
  /*) ;;
  *) DESKTOP_DATA="$HOME/.local/share" ;;
esac
DESKTOP_CONFIG="${XDG_CONFIG_HOME:-}"
case "$DESKTOP_CONFIG" in
  /*) ;;
  *) DESKTOP_CONFIG="$HOME/.config" ;;
esac
# The app has a directory of its own: WebKit keeps the page's localStorage
# beside it in zero-desktop/, which updates and uninstall leave alone.
DESKTOP_HOME="$DESKTOP_DATA/zero-desktop/app"
DESKTOP_ID="zero-desktop.desktop"
DESKTOP_ICON="$DESKTOP_DATA/icons/hicolor/512x512/apps/zero-desktop.png"

desktop_running() {
  has pgrep || return 1
  if [ "$OS" = darwin ]; then
    pgrep -f 'zero-desktop\.app/Contents/MacOS/zero-desktop' >/dev/null 2>&1
  else
    pgrep -x -u "$(id -u)" zero-desktop >/dev/null 2>&1
  fi
}
# shared:desktop:end

# shared:ownership:begin
# Data only: header, name<TAB>basename, then role<TAB>absolute-path<TAB>fingerprint.
# Never source this file or use unverified programs to identify an installation.
occupied() { [ -e "$1" ] || [ -L "$1" ]; }
valid_name() {
  case "$1" in
    '' | [!A-Za-z0-9_]* | *[!A-Za-z0-9_.+-]* | zero-desktop) return 1 ;;
  esac
}

hash() {
  if has sha256sum; then sum="$(sha256sum)" || return 1
  elif has shasum; then sum="$(shasum -a 256)" || return 1
  else fail "sha256sum or shasum is required"
  fi
  printf '%s\n' "${sum%% *}"
}

# Includes names, empty directories, executable bits, link targets, and bytes.
# Directory traversal never follows symlinks.
fingerprint() (
  if [ -L "$1" ]; then
    link="$(readlink "$1")" || exit 1
    content="$(printf '%s\n' "$link" | hash)" || exit 1
    printf 'l:%s\n' "$content"
  elif [ -f "$1" ]; then
    executable=0
    if [ -x "$1" ]; then executable=1; fi
    content="$(hash <"$1")" || exit 1
    printf 'f:%s:%s\n' "$content" "$executable"
  elif [ -d "$1" ]; then
    cd "$1" || exit 1
    listing="$(mktemp "$TMP/tree.XXXXXX")"
    entries="$(mktemp "$TMP/entries.XXXXXX")"
    find . -print >"$listing" || exit 1
    LC_ALL=C sort "$listing" >"$entries"
    while IFS= read -r entry; do
      case "$entry" in *"$TAB"*) exit 1 ;; esac
      printf '%s\t' "$entry"
      if [ -L "$entry" ]; then
        link="$(readlink "$entry")" || exit 1
        content="$(printf '%s\n' "$link" | hash)" || exit 1
        printf 'l:%s\n' "$content"
      elif [ -f "$entry" ]; then
        executable=0
        if [ -x "$entry" ]; then executable=1; fi
        content="$(hash <"$entry")" || exit 1
        printf 'f:%s:%s\n' "$content" "$executable"
      elif [ -d "$entry" ]; then printf 'd\n'
      else exit 1
      fi
    done <"$entries" >"$listing" || exit 1
    content="$(hash <"$listing")" || exit 1
    printf 'd:%s\n' "$content"
  else return 1
  fi
)

init_records() {
  has sha256sum || has shasum || fail "sha256sum or shasum is required"
  TAB="$(printf '\t')"
  if [ "$OS" = darwin ]; then
    ZERO_CONFIG="$HOME/Library/Application Support/zero"
  else
    ZERO_CONFIG="$DESKTOP_CONFIG/zero"
  fi
  RECORD="$ZERO_CONFIG/install.tsv"
  OLD_RECORD="$TMP/old-record"
  : >"$OLD_RECORD"
  OLD_NAME=""
  # Line-oriented records cannot represent tabs/newlines. Refuse, never truncate.
  case "$HOME$ZERO_CONFIG$DESKTOP_DATA${PATH:-}" in
    *"$TAB"* | *'
'*) fail "installation paths cannot contain tabs or newlines" ;;
  esac
  [ ! -L "$ZERO_CONFIG" ] || fail "refusing symlink configuration directory $ZERO_CONFIG"
  if occupied "$ZERO_CONFIG" && [ ! -d "$ZERO_CONFIG" ]; then fail "configuration path is not a directory: $ZERO_CONFIG"; fi
  if occupied "$RECORD"; then
    { [ -f "$RECORD" ] && [ ! -L "$RECORD" ]; } || fail "invalid ownership record $RECORD"
    {
      IFS= read -r header || fail "invalid ownership record $RECORD"
      [ "$header" = zero-install-v1 ] || fail "invalid ownership record $RECORD"
      IFS="$TAB" read -r kind OLD_NAME extra || fail "invalid ownership record $RECORD"
      if [ "$kind" != name ] || [ -n "$extra" ] || ! valid_name "$OLD_NAME"; then
        fail "invalid ownership name in $RECORD"
      fi
      seen=' '
      while IFS="$TAB" read -r role path digest extra; do
        { [ -n "$digest" ] && [ -z "$extra" ]; } || fail "invalid ownership row in $RECORD"
        case "$seen" in *" $role "*) fail "duplicate ownership role in $RECORD" ;; esac
        seen="$seen$role "
        case "$role:$path" in
          "cli:$HOME/.local/bin/$OLD_NAME" | "cli:$HOME/bin/$OLD_NAME" | \
          "link:$HOME/.local/bin/zero-desktop" | "link:$HOME/bin/zero-desktop" | \
          "app:$DESKTOP_HOME" | 'app:/Applications/zero-desktop.app' | "app:$HOME/Applications/zero-desktop.app" | \
          "entry:$DESKTOP_DATA/applications/$DESKTOP_ID" | "icon:$DESKTOP_ICON") ;;
          *) fail "invalid ownership path in $RECORD" ;;
        esac
        case "$digest" in *[!a-f0-9:ldx]*) fail "invalid fingerprint in $RECORD" ;; esac
        printf '%s\t%s\t%s\n' "$role" "$path" "$digest" >>"$OLD_RECORD"
      done
    } <"$RECORD"
  fi
}

owned() {
  [ -f "$OLD_RECORD" ] || return 1
  while IFS="$TAB" read -r _own_role own_path own_digest; do
    own_parent="$(dirname "$own_path")"
    query_parent="$(dirname "$1")"
    if [ "$own_path" = "$1" ] || { [ "${own_path##*/}" = "${1##*/}" ] &&
      [ -d "$own_parent" ] && [ -d "$query_parent" ] &&
      [ "$(cd "$own_parent" && pwd -P)" = "$(cd "$query_parent" && pwd -P)" ]; }; then
      actual="$(fingerprint "$1")" || return 1
      [ "$actual" = "$own_digest" ] && return 0
      return 1
    fi
  done <"$OLD_RECORD"
  return 1
}

check_target() {
  if occupied "$1" && ! owned "$1"; then
    fail "collision: $1 is unrelated or modified; left untouched"
  fi
}

record_path() {
  digest="$(fingerprint "$2")" || fail "cannot fingerprint $2"
  printf '%s\t%s\t%s\n' "$1" "$2" "$digest" >>"$NEW_RECORD"
}
# shared:ownership:end

# shared:cli:begin
on_path() {
  case ":${PATH:-}:" in *":$1:"*) return 0 ;; esac
  return 1
}

# Choose without creating destinations. Probe the nearest existing parent.
writable_dir() (
  probe="$1"
  while ! occupied "$probe"; do probe="$(dirname "$probe")"; done
  [ -d "$probe" ] && [ -w "$probe" ]
)
choose_bin_dir() {
  for dir in "$HOME/.local/bin" "$HOME/bin"; do
    if on_path "$dir" && writable_dir "$dir"; then BIN_DIR="$dir"; return; fi
  done
  BIN_DIR="$HOME/.local/bin"
  writable_dir "$BIN_DIR" || fail "cannot write $BIN_DIR"
}

# Check every executable file on PATH, including entries after our destination.
name_available() {
  candidate="$BIN_DIR/$1"
  if occupied "$candidate" && ! owned "$candidate"; then
    COLLISION="$candidate"
    return 1
  fi
  rest="${PATH:-}"
  while :; do
    dir="${rest%%:*}"
    [ -n "$dir" ] || dir=.
    path="$dir/$1"
    if [ -f "$path" ] && [ -x "$path" ]; then
      absolute="$(cd "$dir" 2>/dev/null && pwd -P)/$1"
      if ! owned "$absolute"; then COLLISION="$path"; return 1; fi
    fi
    case "$rest" in *:*) rest="${rest#*:}" ;; *) break ;; esac
  done
  return 0
}

rerun() {
  printf 'Rerun: curl -fsSL https://raw.githubusercontent.com/%s/main/scripts/%s | sh -s --' "$REPO" "$INSTALL_SCRIPT" >&2
  if [ "$CLI_ONLY" = 1 ]; then printf ' --cli-only' >&2; fi
  if [ -n "${REQUESTED_REF:-}" ]; then printf ' --ref %s' "$REQUESTED_REF" >&2; fi
  printf ' --name %s\n' "$1" >&2
}
select_name() {
  choose_bin_dir
  NAME="${REQUESTED_NAME:-${OLD_NAME:-zero}}"
  if name_available "$NAME"; then return; fi
  warn "collision: $COLLISION is unrelated or modified; left untouched"
  if [ -n "$REQUESTED_NAME" ]; then
    rerun NAME
    fail "explicit name $NAME is occupied"
  fi
  if [ "$NAME" = zero-cli ] || ! name_available zero-cli; then
    rerun NAME
    fail "cannot use $NAME or zero-cli; choose an available --name NAME"
  fi
  # /dev/tty reads the controlling terminal even when sh reads its script on stdin.
  # Open in a subshell: a failed special-builtin redirect must not kill the script.
  if ! (exec 3<>/dev/tty) 2>/dev/null; then
    rerun zero-cli
    fail "confirmation requires a terminal; no destinations changed"
  fi
  answer=""
  answer="$(
    exec 3<>/dev/tty
    printf 'Install as zero-cli instead? [y/N] ' >&3
    IFS= read -r reply <&3 || exit 1
    printf '%s' "$reply"
  )" || answer=""
  case "$answer" in y | Y | yes | YES) NAME=zero-cli ;;
    *) rerun zero-cli; fail "installation cancelled; no destinations changed" ;;
  esac
}

install_cli() {
  target="$BIN_DIR/$NAME"
  updated=0
  if occupied "$target"; then updated=1; fi
  check_target "$target"
  mkdir -p "$BIN_DIR"
  staged="$(mktemp "$BIN_DIR/.zero.XXXXXX")"
  cp "$CLI" "$staged"
  chmod 755 "$staged"
  mv -f "$staged" "$target"
  record_path cli "$target"
  if [ "$updated" = 1 ]; then ok "updated $target (zero $VERSION)"
  else ok "installed $target (zero $VERSION)"
  fi
  if ! on_path "$BIN_DIR"; then
    warn "$BIN_DIR is not on PATH; add it:"
    case "$(basename "${SHELL:-sh}")" in
      fish) note "fish_add_path \"$BIN_DIR\"" ;;
      zsh) note "export PATH=\"$BIN_DIR:\$PATH\"   # in ~/.zshrc" ;;
      bash) note "export PATH=\"$BIN_DIR:\$PATH\"   # in ~/.bashrc" ;;
      *) note "export PATH=\"$BIN_DIR:\$PATH\"   # in ~/.profile" ;;
    esac
  fi
}

finish_records() {
  # Preserve components omitted by --cli-only, including their old fingerprints.
  while IFS="$TAB" read -r role path digest; do
    if [ "$role" != cli ] && [ "$CLI_ONLY" = 1 ]; then
      printf '%s\t%s\t%s\n' "$role" "$path" "$digest" >>"$NEW_RECORD"
    fi
  done <"$OLD_RECORD"
  mkdir -p "$ZERO_CONFIG"
  record_stage="$(mktemp "$ZERO_CONFIG/.install.XXXXXX")"
  { printf 'zero-install-v1\nname\t%s\n' "$NAME"; cat "$NEW_RECORD"; } >"$record_stage"
  chmod 600 "$record_stage"
  mv -f "$record_stage" "$RECORD"
  # Retire an old command only after the new installation and record succeed.
  while IFS="$TAB" read -r role path digest; do
    if [ "$role" = cli ] && [ "$path" != "$BIN_DIR/$NAME" ] && occupied "$path"; then
      if owned "$path"; then rm -f "$path"; ok "retired $path"
      else warn "kept $path: ownership changed"
      fi
    fi
  done <"$OLD_RECORD"
}

# shared:cli:end

# shared:daemon:begin
# stop_daemon stops a running zero daemon with the CLI just installed. A daemon
# serves the web app of the build that started it until it exits, so without
# this the next zero would keep showing the old build (decision 0136). A
# running desktop app would start its own daemon again at once, so it is left
# alone then.
stop_daemon() {
  if desktop_running; then
    warn "the zero desktop app is running, so its daemon keeps the old build; quit the app, then run '$NAME daemon stop'"
    return 0
  fi
  if ! stopped="$("$BIN_DIR/$NAME" daemon stop 2>&1)"; then
    warn "could not stop the running zero daemon; run '$NAME daemon stop'"
    return 0
  fi
  if [ "$stopped" = stopped ]; then ok "stopped the running zero daemon; the next $NAME starts this build"; fi
}
# shared:daemon:end

# shared:desktop-install:begin
# check_webkit warns on Linux without WebKitGTK 4.1, which the app's window
# needs. The app still installs: the check cannot see every library path.
check_webkit() {
  [ "$OS" = linux ] || return 0
  finder="$(command -v ldconfig 2>/dev/null || true)"
  if [ -z "$finder" ] && [ -x /sbin/ldconfig ]; then finder=/sbin/ldconfig; fi
  [ -n "$finder" ] || return 0
  if ! "$finder" -p 2>/dev/null | grep -q 'libwebkit2gtk-4\.1\.so\.0'; then
    warn "WebKitGTK 4.1 not found; the app needs it to open a window. Debian, Ubuntu:"
    note "sudo apt install libwebkit2gtk-4.1-0"
  fi
}

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

check_desktop_conflicts() {
  if desktop_running; then fail "the zero desktop app is running; quit it, then run this again"; fi
  check_target "$BIN_DIR/zero-desktop"
  # Also protect executable zero-desktop copies elsewhere on PATH.
  name_available zero-desktop || fail "collision: $COLLISION is unrelated or modified; left untouched"
  if [ "$OS" = linux ]; then
    APP_TARGET="$DESKTOP_HOME"
    check_target "$DESKTOP_DATA/applications/$DESKTOP_ID"
    check_target "$DESKTOP_ICON"
  else
    apps=/Applications
    if [ ! -d "$apps" ] || [ ! -w "$apps" ]; then apps="$HOME/Applications"; fi
    APP_TARGET="$apps/zero-desktop.app"
  fi
  check_target "$APP_TARGET"
  for destination in "$APP_TARGET" "$BIN_DIR/zero-desktop"; do
    writable_dir "$(dirname "$destination")" || fail "cannot write $destination"
  done
  if [ "$OS" = linux ]; then
    for destination in "$DESKTOP_DATA/applications/$DESKTOP_ID" "$DESKTOP_ICON"; do
      writable_dir "$(dirname "$destination")" || fail "cannot write $destination"
    done
  fi
}

# desktop_exec PATH renders PATH as one desktop entry Exec argument.
desktop_exec() {
  value="$(printf '%s' "$1" | sed 's/%/%%/g')"
  case "$value" in
    *[!A-Za-z0-9_./+,:@=-]*)
      # shellcheck disable=SC2016 # sed expression, not shell expansion
      value="\"$(printf '%s' "$value" | sed 's/[\\"`$]/\\&/g')\""
      ;;
  esac
  printf '%s' "$value" | sed 's/\\/\\\\/g'
}

# replace_path SRC DEST copies SRC over DEST, swapping it in once copied.
replace_path() {
  check_target "$2"
  parent="$(dirname "$2")"
  mkdir -p "$parent"
  replacement="$(mktemp -d "$parent/.zero.XXXXXX")"
  if has ditto; then ditto "$1" "$replacement/app"
  else cp -R "$1" "$replacement/app"
  fi
  rm -rf "$2"
  mv "$replacement/app" "$2"
  rmdir "$replacement"
}

# Install metadata through a private file, including over read-only owned files.
install_file() {
  check_target "$2"
  metadata_stage="$(mktemp "$(dirname "$2")/.zero.XXXXXX")"
  cp "$1" "$metadata_stage"
  chmod 644 "$metadata_stage"
  mv -f "$metadata_stage" "$2"
}

# link_desktop TARGET links BIN_DIR/zero-desktop to TARGET.
link_desktop() {
  check_target "$BIN_DIR/zero-desktop"
  mkdir -p "$BIN_DIR"
  rm -f "$BIN_DIR/zero-desktop"
  ln -s "$1" "$BIN_DIR/zero-desktop"
  record_path link "$BIN_DIR/zero-desktop"
  ok "linked $BIN_DIR/zero-desktop"
}

# install_desktop_linux DIR installs the unpacked Linux archive DIR, its
# desktop entry and icon, and makes it the zero:// handler.
install_desktop_linux() {
  if ! [ -x "$1/zero-desktop" ] || ! [ -x "$1/bin/zero" ]; then
    fail "$package has no zero-desktop app"
  fi
  mkdir -p "$DESKTOP_DATA/zero-desktop"
  replace_path "$1" "$DESKTOP_HOME"
  record_path app "$DESKTOP_HOME"
  ok "installed $DESKTOP_HOME (zero-desktop $VERSION)"
  exec_arg="$(desktop_exec "$DESKTOP_HOME/zero-desktop")"
  mkdir -p "$DESKTOP_DATA/applications" "$(dirname "$DESKTOP_ICON")" "$DESKTOP_CONFIG"
  install_file "$DESKTOP_HOME/zero-desktop.png" "$DESKTOP_ICON"
  cat >"$TMP/desktop-entry" <<EOF2
[Desktop Entry]
Type=Application
Name=Zero
Comment=Browse local files with Zero
Exec=$exec_arg %U
Icon=zero-desktop
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/zero;
EOF2
  install_file "$TMP/desktop-entry" "$DESKTOP_DATA/applications/$DESKTOP_ID"
  record_path entry "$DESKTOP_DATA/applications/$DESKTOP_ID"
  record_path icon "$DESKTOP_ICON"
  if has update-desktop-database; then
    update-desktop-database "$DESKTOP_DATA/applications" >/dev/null 2>&1 || true
  fi
  if has xdg-mime && xdg-mime default "$DESKTOP_ID" x-scheme-handler/zero; then
    ok "registered zero:// links"
  else
    warn "could not set the zero:// handler (xdg-mime); $NAME . may serve in a browser instead"
  fi
  link_desktop "$DESKTOP_HOME/zero-desktop"
}

# install_desktop_macos APP installs zero-desktop.app into /Applications, or
# ~/Applications when /Applications is not writable.
install_desktop_macos() {
  apps="$(dirname "$APP_TARGET")"
  replace_path "$1" "$APP_TARGET"
  record_path app "$APP_TARGET"
  if [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -f "$apps/zero-desktop.app" >/dev/null 2>&1 || true
  fi
  ok "installed $apps/zero-desktop.app"
  link_desktop "$apps/zero-desktop.app/Contents/MacOS/zero-desktop"
}

# install_desktop installs the app unpack_desktop unpacked.
install_desktop() {
  if [ "$OS" = linux ]; then
    install_desktop_linux "$TMP/desktop"
  else
    [ -d "$TMP/desktop/zero-desktop.app" ] || fail "$package has no zero-desktop.app"
    install_desktop_macos "$TMP/desktop/zero-desktop.app"
  fi
}
# shared:desktop-install:end

# shared:unpack:begin
validate_members() {
  [ -s "$1" ] || fail "empty archive"
  while IFS= read -r member; do
    case "$member" in /* | ../* | */../* | */.. | .. | *\\* | *"$TAB"*) fail "unsafe archive member: $member" ;; esac
  done <"$1"
}
validate_tar() {
  tar -tzf "$1" >"$TMP/archive-list" || fail "invalid archive $1"
  validate_members "$TMP/archive-list"
  # Release tarballs contain files and directories, never device nodes or links.
  tar -tvzf "$1" >"$TMP/archive-types" || fail "invalid archive $1"
  if LC_ALL=C grep -q '^[^d-]' "$TMP/archive-types"; then fail "unsafe archive entry in $1"; fi
}

# unpack_cli ARCHIVE extracts zero_<VERSION>_<OS>_<ARCH>.tar.gz and sets CLI.
unpack_cli() {
  name="zero_${VERSION}_${OS}_${ARCH}"
  validate_tar "$1"
  mkdir -p "$TMP/cli"
  tar -xzf "$1" -C "$TMP/cli"
  CLI="$TMP/cli/$name/zero"
  { [ -f "$CLI" ] && [ -x "$CLI" ] && [ ! -L "$CLI" ]; } || fail "$name.tar.gz has no executable zero binary"
}

# desktop_package sets package, the desktop app's asset name for VERSION.
desktop_package() {
  if [ "$OS" = linux ]; then
    package="zero-desktop_${VERSION}_linux_${ARCH}.tar.gz"
  else
    package="zero-desktop_${VERSION}_darwin_${ARCH}.zip"
  fi
}

# unpack_desktop ARCHIVE unpacks the desktop app package into TMP/desktop.
unpack_desktop() {
  mkdir -p "$TMP/desktop"
  if [ "$OS" = linux ]; then
    validate_tar "$1"
    tar -xzf "$1" -C "$TMP/desktop"
  else
    unzip -tq "$1" >/dev/null || fail "invalid archive $package"
    unzip -Z -l "$1" >"$TMP/archive-types" || fail "invalid archive $package"
    if LC_ALL=C grep -q '^[lbcps]' "$TMP/archive-types"; then fail "unsafe archive entry in $package"; fi
    unzip -Z1 "$1" >"$TMP/archive-list" || fail "invalid archive $package"
    validate_members "$TMP/archive-list"
    if has ditto; then
      ditto -x -k "$1" "$TMP/desktop"
    else
      unzip -q "$1" -d "$TMP/desktop"
    fi
  fi
  if [ "$OS" = linux ]; then
    { [ -f "$TMP/desktop/zero-desktop" ] && [ -x "$TMP/desktop/zero-desktop" ] &&
      [ -f "$TMP/desktop/bin/zero" ] && [ -x "$TMP/desktop/bin/zero" ] &&
      [ -f "$TMP/desktop/zero-desktop.png" ]; } || fail "$package has no valid zero-desktop app"
  else
    { [ -x "$TMP/desktop/zero-desktop.app/Contents/MacOS/zero-desktop" ] &&
      [ -x "$TMP/desktop/zero-desktop.app/Contents/Resources/bin/zero" ]; } || fail "$package has no valid zero-desktop.app"
  fi
}
# shared:unpack:end


# Options: --ref and --name. The desktop app always installs: --cli-only is
# for scripts/install.sh only.
CLI_ONLY=0
REQUESTED_NAME=""
REQUESTED_REF=""
parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref)
        [ "$#" -ge 2 ] || fail "--ref requires a branch or commit SHA"
        shift
        case "$1" in '' | -* | HEAD) fail "invalid --ref: name a branch on origin or a commit SHA" ;; esac
        REQUESTED_REF="$1"
        ;;
      --name)
        [ "$#" -ge 2 ] || fail "--name requires a simple executable basename"
        shift
        valid_name "$1" || fail "invalid --name: use a simple executable basename"
        REQUESTED_NAME="$1"
        ;;
      *) fail "unknown option $1; use --ref REF or --name NAME" ;;
    esac
    shift
  done
  REF="${REQUESTED_REF:-main}"
}

check_tools() {
  has git || fail "git is required; install it, then run this again"
  has mise || fail "mise is required: https://mise.jdx.dev/getting-started.html"
  has jq || fail "jq is required: https://jqlang.org/download/"
}

# slug TEXT prints TEXT as one semver prerelease identifier, also valid in a
# Docker tag: runs of other characters become -, at most 64 characters, and an
# all-digit result gets b- (a numeric identifier may not lead with 0).
slug() {
  value="$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9-' '-' | sed 's/--*/-/g; s/^-//' | cut -c 1-64 | sed 's/-*$//')"
  case "$value" in
    '') value=branch ;;
    *[!0-9]*) ;;
    *) value="b-$value" ;;
  esac
  printf '%s' "$value"
}

# resolve_ref clones origin without file contents and checks out REF: a branch
# on origin, or a commit SHA (7 to 40 hex digits) on one of its branches. GitHub
# serves fork commits through this repository too; they are on no origin
# branch. Sets SRC, COMMIT, and VERSION.
resolve_ref() {
  SRC="$TMP/src"
  step "fetching github.com/$REPO"
  git clone --quiet --filter=blob:none --no-checkout "https://github.com/$REPO.git" "$SRC" ||
    fail "could not clone https://github.com/$REPO.git"
  if git -C "$SRC" show-ref --verify --quiet "refs/remotes/origin/$REF"; then
    COMMIT="$(git -C "$SRC" rev-parse --verify --quiet "refs/remotes/origin/$REF^{commit}")" ||
      fail "branch $REF has no commit"
    label="$(slug "$REF")"
  else
    sha="$(printf '%s' "$REF" | tr 'A-F' 'a-f')"
    case "$sha" in
      *[!0-9a-f]*) fail "$REF is neither a branch on origin nor a commit SHA" ;;
    esac
    if [ "${#sha}" -lt 7 ] || [ "${#sha}" -gt 40 ]; then
      fail "$REF is neither a branch on origin nor a commit SHA (7 to 40 hex digits)"
    fi
    COMMIT="$(git -C "$SRC" rev-parse --verify --quiet "$sha^{commit}")" ||
      fail "no commit $REF on origin, or more than one starts with it"
    [ -n "$(git -C "$SRC" for-each-ref --contains "$COMMIT" refs/remotes/origin)" ] ||
      fail "commit $REF is on no origin branch; forks are not supported"
    label="g$(printf '%.12s' "$COMMIT")"
  fi
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet --detach "$COMMIT" ||
    fail "could not check out $COMMIT"
  VERSION="0.0.0-dev.$label"
}

# dev_mise ARGS... runs mise in the clone with the dist contract's variables,
# trusting the clone's config for that command only (no trust record).
dev_mise() {
  (cd "$SRC" && env MISE_TRUSTED_CONFIG_PATHS="$SRC" MISE_YES=1 \
    ZERO_DIST_VERSION="$VERSION" ZERO_DIST_OUT="$TMP/dist" mise "$@")
}

# build_dist builds COMMIT with its own `mise run dist` into TMP/dist, and the
# zero-dev:VERSION image with `mise run dist:image` when Docker runs. Sets
# IMAGE when the image built.
build_dist() {
  grep -q '^\[tasks\.dist\]' "$SRC/mise.toml" 2>/dev/null ||
    fail "$REF predates install-dev (its mise.toml has no dist task); pick a newer ref"
  step "building zero $VERSION ($(printf '%.12s' "$COMMIT")); a first build downloads toolchains and takes minutes"
  { dev_mise install && dev_mise run dist; } || fail "the build of $REF failed; nothing was installed"
  IMAGE=""
  if has docker && docker info >/dev/null 2>&1; then
    step "building the zero-dev:$VERSION image for zero attach"
    if dev_mise run dist:image; then
      IMAGE="zero-dev:$VERSION"
    else
      warn "the zero-dev:$VERSION image did not build; zero attach needs it"
    fi
  else
    warn "Docker is not running, so no zero-dev:$VERSION image; zero attach needs it"
  fi
}

# unpack_dist unpacks the archive and desktop package build_dist made.
unpack_dist() {
  name="zero_${VERSION}_${OS}_${ARCH}"
  [ -f "$TMP/dist/$name.tar.gz" ] || fail "the build made no $name.tar.gz"
  unpack_cli "$TMP/dist/$name.tar.gz"
  desktop_package
  [ -f "$TMP/dist/$package" ] || fail "the build made no $package"
  unpack_desktop "$TMP/dist/$package"
}

INSTALL_SCRIPT=install-dev.sh

parse_args "$@"
detect_platform
if [ "$OS" = darwin ] && [ "$ARCH" = amd64 ]; then
  fail "install-dev cannot build on macOS Intel (pnpm ships no binary for it); use scripts/install.sh"
fi
check_tools
make_tmp
init_records
select_name
writable_dir "$ZERO_CONFIG" || fail "cannot write $ZERO_CONFIG"
check_desktop_conflicts
resolve_ref
build_dist
unpack_dist
# All preflight checks and the build finish before either destination changes.
NEW_RECORD="$TMP/new-record"
: >"$NEW_RECORD"
install_desktop
install_cli
finish_records
stop_daemon
check_webkit
if [ -n "$IMAGE" ]; then ok "built $IMAGE for zero attach"; fi
ok "done; open the current directory with:"
note "$NAME ."
