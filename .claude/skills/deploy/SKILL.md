---
name: deploy
description: Merge a green PR, tag the release, wait for the GHA build and restart production, from the hosted dev container
argument-hint: "[PR number]"
allowed-tools: Bash, Read
---

# Deploy ROTV to production from dev.rootsofthevalley.org

For sessions running in the hosted dev container (`/work/rotv`). A laptop session
has its own personal `/deploy`, which takes precedence over this one there.

The container holds an SSH key that can run three words on the production host and
nothing else: `ssh rotv-prod deploy`, `ssh rotv-prod status`, `ssh rotv-prod logs`.
If `ssh rotv-prod status` fails, stop and say so; do not look for another way in.

## 1. Find the PR

Use the PR number given, or the open PR for the current branch (`gh pr view`). If the
branch has unpushed or uncommitted work, commit and push it and let the checks run
first. With no PR and a clean `master`, skip to step 5: that redeploys the current image.

## 2. Merge

```bash
gh pr checks <PR> --watch
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
gh run watch <RUN_ID> --exit-status
```

If it fails, show `gh run view <RUN_ID> --log-failed` and stop.

## 5. Deploy

```bash
ssh rotv-prod deploy
```

It restarts the production service, which pulls `:latest` and runs every migration at
boot, then waits for the backend to answer. It prints the image before and after; the
second field is the commit the image was built from, which should be the merge commit.
A non-zero exit comes with the service journal: report it, do not retry blindly.

## 6. Verify and report

```bash
curl -fsS https://rootsofthevalley.org/api/health
```

Then check the thing that shipped is actually there. Report the PR, the tag, the build
run and the deployed commit in a few lines.
