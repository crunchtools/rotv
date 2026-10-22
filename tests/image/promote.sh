#!/usr/bin/env bash
# Copy a tested digest to its promoted tags, without rebuilding.
#
#   TAGS="<one tag per line>" tests/image/promote.sh <registry/name@sha256:...>
#
# On a branch, :latest is dropped when the branch has moved past this run's
# commit: concurrency groups order runs, not commits, so an older run that
# reaches promotion late must not move :latest back over a newer one.
#
# GIT and DOCKER can be overridden (tests/image/test-promote.sh stubs them).
set -euo pipefail

src=${1:?usage: TAGS=... promote.sh <image@digest>}
git_cmd=${GIT:-git}
docker_cmd=${DOCKER:-docker}
tags=${TAGS:?TAGS is empty}

if [ "${GITHUB_REF_TYPE:-}" = branch ]; then
  head=$($git_cmd ls-remote "https://github.com/$GITHUB_REPOSITORY" "$GITHUB_REF" | cut -f1)
  if [ "$head" != "$GITHUB_SHA" ]; then
    echo "::warning::$GITHUB_REF is at $head now; leaving :latest alone for $GITHUB_SHA"
    tags=$(grep -v ':latest$' <<<"$tags" || true)
  fi
fi

for t in $tags; do
  echo "promote $src -> $t"
  $docker_cmd buildx imagetools create -t "$t" "$src"
done
