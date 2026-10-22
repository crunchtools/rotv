#!/usr/bin/env bash
# Tests for promote.sh with git and docker stubbed out.
set -euo pipefail
cd "$(dirname "$0")"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# git stub prints whatever head the case sets; docker stub logs each tag
printf '#!/bin/sh\necho "$STUB_HEAD\trefs/heads/master"\n' > "$work/git"
printf '#!/bin/sh\necho "$5" >> "$STUB_LOG"\n' > "$work/docker"
chmod +x "$work/git" "$work/docker"

src=quay.io/x/y@sha256:abc
tags=$'quay.io/x/y:latest\nquay.io/x/y:1a2b3c4\nghcr.io/x/y:latest\nghcr.io/x/y:1a2b3c4'
fail=0

run() {  # run <name> <ref_type> <head> <expected tags, space separated>
  local name=$1 ref_type=$2 head=$3 want=$4 got
  : > "$work/log"
  GIT="$work/git" DOCKER="$work/docker" STUB_HEAD=$head STUB_LOG="$work/log" \
    GITHUB_REF_TYPE=$ref_type GITHUB_REF=refs/heads/master GITHUB_SHA=1a2b3c4 \
    GITHUB_REPOSITORY=x/y TAGS=$tags ./promote.sh "$src" >/dev/null
  got=$(tr '\n' ' ' < "$work/log" | sed 's/ $//')
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: got '$got' want '$want'"; fail=1; fi
}

run "current branch head promotes every tag" branch 1a2b3c4 \
  "quay.io/x/y:latest quay.io/x/y:1a2b3c4 ghcr.io/x/y:latest ghcr.io/x/y:1a2b3c4"
run "stale run leaves :latest alone" branch 9f9f9f9 \
  "quay.io/x/y:1a2b3c4 ghcr.io/x/y:1a2b3c4"
run "tag ref skips the head check" tag 9f9f9f9 \
  "quay.io/x/y:latest quay.io/x/y:1a2b3c4 ghcr.io/x/y:latest ghcr.io/x/y:1a2b3c4"

exit $fail
