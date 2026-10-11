# Spec 051: The hosted dev site is driven from outside its container

## Why
The hosted dev container (#748) carried the agent that edits the code: Claude Code, gh, a
Remote Control unit, the agent's logins on its state volume and an SSH key to the production
host. The agent ran as root inside the thing it was editing, and could not be reused for any
other site.

The agent now runs in a container of its own (#779). That container has the site's directory
bind-mounted, no shell in the dev container and no route to the host. So the dev site needs
an inner loop that works through files.

## User stories
- As the agent, I save a backend file and the backend is running my change, without asking anything to restart it.
- As the agent, I add a migration or a dependency and the site applies it.
- As the agent, when something is stuck I can restart one part of the site, and read its log to see why.
- As the agent, I run the unit tests from the checkout I am editing.
- As the owner, the dev container holds nothing worth stealing: no agent login, no GitHub token, no key to production.
- As the owner, I ship from my phone as before: the session merges, tags, waits for the build and restarts production.

## The contract
Two directories beside the checkout, mounted into both containers.

| Path | Direction | Meaning |
|---|---|---|
| `data/checkout/` | agent writes | The code. Vite hot-reloads it; `rotv-backend` runs under `node --watch`. |
| `data/control/<name>` | agent touches | Restart the units behind `<name>`: `ui`, `backend`, `init` (migrations, then backend), `deps` (npm ci, then both servers). Any other name does nothing. |
| `data/logs/<unit>.log` | agent reads | The last 1,000 lines of that unit's journal, rewritten every few seconds. `control.log` records the last 500 kicks. Both are capped: the files sit on the host's disk. |

A changed `package-lock.json` runs `deps` and a change in `backend/migrations/` runs `init`
without a touch.

The contract is deliberately not specific to this app: a path unit per control name, a script
that maps a name to units, a journal mirror per unit. Another site adopts it by shipping the
same three pieces with its own names.

## Decisions
- **Files, not a socket or an API.** The agent container has no network path to the dev
  container and should not get one. A bind mount is already there, inotify crosses it, and a
  file's name is an interface small enough to read in one line.
- **A closed set of names.** The script refuses a name it does not know, so a file written
  into `control/` cannot restart or start anything else.
- **The journal stays the record.** Logs are mirrored to files rather than redirected, so
  the container still logs the way every other one does.
- **`node_modules` in the checkout.** They were named volumes, invisible to a second
  container. In the checkout the agent can run vitest against what the site runs.
- **Deploy through the gateway.** The forced-command SSH key granted one thing: restart the
  production unit. The MCP gateway's systemd tool grants the same thing to a session with no
  route to the host, so the key and `scripts/rotv-deploy.sh` are removed.

## Out of scope
- Whole-container restarts of the dev site. Only a new image needs one, and that is the
  host's job.
- Any change to the production image or its units.

## Verification
- CI builds `rotv-dev` from `Containerfile.dev`.
- On the host, after the dev container restarts on the new image: `claude`, `gh` and `git`
  are absent; a touch on each control name restarts its units and is recorded in
  `control.log`; a backend edit restarts `rotv-backend` on its own; each log file fills;
  `npx vitest` runs from the checkout in the agent container; the site answers.
