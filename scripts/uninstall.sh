#!/bin/sh
# Removes only fingerprint-verified installer-owned files. Retains user data.
# shellcheck disable=SC2034

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

detect_platform
make_tmp
init_records
if desktop_running; then fail "the zero desktop app is running; quit it, then run this again"; fi
# Only execute a fingerprint-verified CLI, never a PATH lookup or bundled stranger.
while IFS="$TAB" read -r role path digest; do
  program=""
  if owned "$path"; then
    case "$role" in
      cli) program="$path" ;;
      app)
        if [ "$OS" = linux ]; then program="$path/bin/zero"
        else program="$path/Contents/Resources/bin/zero"
        fi
        ;;
    esac
  fi
  if [ -n "$program" ] && [ -x "$program" ]; then
    if "$program" daemon status >/dev/null 2>&1; then
      fail "a zero daemon is running; stop it with '$program daemon stop', then run this again"
    fi
  fi
done <"$OLD_RECORD"
REMOVED=0
REMAINING="$TMP/remaining"
: >"$REMAINING"
while IFS="$TAB" read -r role path digest; do
  if ! occupied "$path"; then continue; fi
  if owned "$path"; then
    rm -rf "$path"
    ok "removed $path"
    REMOVED=$((REMOVED + 1))
  else
    warn "kept $path: unrelated or modified"
    printf '%s\t%s\t%s\n' "$role" "$path" "$digest" >>"$REMAINING"
  fi
done <"$OLD_RECORD"
if [ -s "$REMAINING" ]; then
  record_stage="$(mktemp "$ZERO_CONFIG/.install.XXXXXX")"
  { printf 'zero-install-v1\nname\t%s\n' "$OLD_NAME"; cat "$REMAINING"; } >"$record_stage"
  chmod 600 "$record_stage"
  mv -f "$record_stage" "$RECORD"
elif [ -f "$RECORD" ]; then rm -f "$RECORD"
fi
# Report other copies without executing or deleting them, including old srcz.
for name in "${OLD_NAME:-zero}" zero zero-desktop; do
  rest="${PATH:-}"
  while :; do
    dir="${rest%%:*}"
    [ -n "$dir" ] || dir=.
    if occupied "$dir/$name"; then warn "kept $dir/$name: not removed; use its installation tool"; fi
    case "$rest" in *:*) rest="${rest#*:}" ;; *) break ;; esac
  done
done
if [ "$REMOVED" = 0 ]; then ok "nothing to remove in $HOME"
else ok "uninstalled zero"
fi
step "kept your data (delete it yourself if you no longer need it):"
if [ "$OS" = linux ]; then
  note "$ZERO_CONFIG"
  note "$DESKTOP_DATA/zero-desktop"
else
  note "$ZERO_CONFIG"
  note "$HOME/Library/WebKit/io.github.flexdinesh.zero.desktop"
fi
