---
name: deploy
description: Merge a green PR, tag the release, wait for the GHA build and restart production, from a session working on the hosted dev checkout
argument-hint: "[PR number]"
allowed-tools: Bash, Read, mcp__trentina__unit_status, mcp__trentina__unit_restart, mcp__trentina__journal_query, mcp__trentina__container_inspect, mcp__trentina__fetch
---

# Deploy ROTV to production from the hosted dev checkout

For sessions working on `/srv/dev.rootsofthevalley.org/data/checkout`. A laptop
session has its own personal `/deploy`, which takes precedence over this one there.

This session has no login on the production host. The one thing it can do
there is what the MCP gateway's systemd tools allow: read and restart the
production unit, `rootsofthevalley.org.service`. If those tools are missing or
refuse, stop and say so; do not look for another way in.

## 1. Find the PR

Use the PR number given, or the open PR for the current branch (`gh pr view`). If the
branch has unpushed or uncommitted work, commit and push it and let the checks run
first. With no PR and a clean `master`, skip to step 5: that redeploys the current image.

## 2. Merge

```bash
gh pr checks <PR> --watch --interval 60
gh pr merge <PR> --merge --delete-branch
```

Do not merge with a failing or pending required check.

## 3. Move the checkout to master

The dev site serves this checkout, so it follows the merge:

```bash
git checkout master && git fetch origin --prune --tags && git pull --ff-only
```

## 4. Tag the release and wait for the build

Git tags are the version. Pick the next SemVer from what merged (`git log $(git tag
--sort=-v:refname | head -1)..HEAD --oneline`): a feature is a minor, a fix is a patch.

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z: <summary>"
git push origin vX.Y.Z
```

The image production runs is `:latest`, built by the push to `master`, not by the tag:

```bash
gh run list --workflow=build.yml --branch=master --event=push --limit=1
gh run watch <RUN_ID> --exit-status --interval 60
```

If it fails, show `gh run view <RUN_ID> --log-failed` and stop.

## 5. Deploy

The production unit pulls `:latest` before it starts, so a restart is the deploy.

1. `container_inspect` on `rootsofthevalley.org`: note the image's
   `org.opencontainers.image.revision` label. That is the commit running now.
2. `unit_restart` on `rootsofthevalley.org.service`.
3. The container boots PostgreSQL and runs every migration before the backend
   listens, which can take a few minutes. Poll `unit_status` until it is
   active, then `fetch` `https://rootsofthevalley.org/api/health` until it
   answers, waiting between tries. Give it five minutes.
4. `container_inspect` again: the revision should now be the merge commit.

If the unit fails or health never answers, read `journal_query` for the unit
and report what it says. Do not restart it again blindly.

## 6. Verify and report

Check the thing that shipped is actually there. Report the PR, the tag, the build
run and the deployed commit in a few lines.
