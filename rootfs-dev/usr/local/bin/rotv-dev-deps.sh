#!/bin/bash
# Install backend and frontend dependencies into the node_modules volumes, and
# again only when a lockfile changes (a branch that adds a package).
set -e

for pkg in backend frontend; do
  cd "/work/rotv/$pkg"
  lock_sha=$(sha256sum package-lock.json | cut -d" " -f1)
  if [ "$(cat node_modules/.lock-sha 2>/dev/null)" = "$lock_sha" ]; then
    echo "$pkg dependencies are current"
    continue
  fi
  echo "Installing $pkg dependencies..."
  npm ci --include=dev --no-audit --no-fund --loglevel=error
  echo "$lock_sha" > node_modules/.lock-sha
done
