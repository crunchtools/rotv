#!/usr/bin/env bash
# Image contract test: assert what an image contains without booting it.
#
#   tests/image/contract.sh <image-ref> <profile>
#
# Reads tests/image/<profile>.expect. One directive per line:
#   exec    <path-or-glob>   must exist and be executable
#   file    <path-or-glob>   must exist
#   absent  <path-or-glob>   must not exist
#   enabled <unit>           systemctl is-enabled reports "enabled"
#   include <profile>        pull in another profile's directives
#
# On 2026-10-22 a green build shipped with no PostgreSQL, no Weston, and a
# live RHSM registration, because a failed dnf was swallowed by `|| true`.
# Every one of those is a line in an .expect file now.
#
# CONTAINER_ENGINE picks docker (CI) or podman (default).
set -euo pipefail

image=${1:?usage: contract.sh <image-ref> <profile>}
profile=${2:?usage: contract.sh <image-ref> <profile>}
engine=${CONTAINER_ENGINE:-podman}
dir=$(cd "$(dirname "$0")" && pwd)

expand() {
  local f="$dir/$1.expect"
  [ -f "$f" ] || { echo "contract: no such profile: $1" >&2; exit 2; }
  while read -r kind arg; do
    case "$kind" in
      ''|'#'*) ;;
      include) expand "$arg" ;;
      *) printf '%s %s\n' "$kind" "$arg" ;;
    esac
  done < "$f"
}

# One container run checks every directive; globs expand inside the image.
checker='
fail=0
while read -r kind arg; do
  set -- $arg
  case "$kind" in
    exec)    [ -x "$1" ] || { echo "FAIL exec    $arg"; fail=1; } ;;
    file)    [ -e "$1" ] || { echo "FAIL file    $arg"; fail=1; } ;;
    absent)  [ -e "$1" ] && { echo "FAIL absent  $arg (present)"; fail=1; } ;;
    enabled) s=$(systemctl is-enabled "$arg" 2>&1) || true
             [ "$s" = enabled ] || { echo "FAIL enabled $arg ($s)"; fail=1; } ;;
    *)       echo "FAIL unknown directive: $kind"; fail=1 ;;
  esac
done
exit $fail
'

directives=$(expand "$profile")
echo "contract: $image against '$profile' ($(wc -l <<<"$directives") checks)"
if "$engine" run --rm -i --entrypoint /bin/sh "$image" -c "$checker" <<<"$directives"; then
  echo "contract: PASS"
else
  echo "contract: FAIL"
  exit 1
fi
