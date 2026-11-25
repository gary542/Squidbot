<!-- Adapted from openclaw/openclaw (MIT), modified for Squidbot. -->

# Squidbot

Squidbot is a self-hosted personal AI bot. It is the current OpenClaw gateway
(v2026.11.10) with the OpenMausBot ideas that OpenClaw did not have: spend
caps and pause, connected apps through a self-hosted Composio project key,
and team export that scrubs secrets. Later phases (boxed turns, desktops,
rooms, and the phone relay) are in the tree and covered by tests. They stay
off until you set a flag.

Squidbot is Apache-2.0. OpenClaw's MIT notice, OpenMausBot's Apache-2.0
notice, and the pi-mono MIT notice are kept. See `NOTICE`, `LICENSE`, and
`THIRD_PARTY_NOTICES.md`.

## Run locally

Requirements match the upstream gateway: Node.js 22.12 or newer (Node 24 is
what this tree is developed on) and pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm squidbot onboard --install-daemon
pnpm squidbot gateway status
pnpm squidbot dashboard
```

The product command is `squidbot`. The npm package name stays `openclaw`
because plugins import that specifier, and the `openclaw` command remains
so the upstream build scripts keep working. When you launch `squidbot`, the
banner and the command name say Squidbot.

State defaults to `~/.squidbot` unless `OPENCLAW_STATE_DIR` or
`SQUIDBOT_STATE_DIR` is set. Caps and pause live in `<state>/squidbot/`.

## What works now

| Phase | Status | What you can do |
|---|---|---|
| 0 | Done | Rebranded snapshot, Apache-2.0, attribution headers, `pnpm test:squidbot` |
| 1 | Done | Usage caps, pause, Composio grants (your project key only), team export and import |
| 2 | Wired, flag off | Exec uses bubblewrap when `SQUIDBOT_BOT_BOX=1` and `bwrap` exists, otherwise a token-only fallback. Computer status observes per-agent Podman and SSH desktops when `SQUIDBOT_DESKTOPS=1`. |
| 3 | Wired, flag off | A `room:` session routes between members (0.6, 1.5s, depth 4, 300 turns) when `SQUIDBOT_ROOMS=1`. @mentions and `/assign` delegate. Spend caps and pause still hold. The Control UI page is `/rooms`. |
| 4 | Library, flag off | Noise handshake and a blind relay admission check (close 4404) |

### Caps and pause

```bash
# daily token cap for unattended work (cron, heartbeats, hand-offs)
export SQUIDBOT_USAGE_CAP_DAILY_TOKENS=100000
export SQUIDBOT_USAGE_CAP_STOPS=unattended   # or everything

squidbot agents pause researcher
squidbot agents resume researcher
squidbot agents resume --all
squidbot agents caps --agent researcher
```

A reached cap refuses the run with status 409 and code `spend_cap`. A paused
agent is refused with 409 `bot_held`. A person's own chat still runs when the
stop mode is `unattended`. `everything` stops that too. The chat gate and the
cron gate both call this check.

### Connected apps

Set `SQUIDBOT_COMPOSIO_API_KEY` to a Composio **project** key (`ak_…`). There
is no hosted broker. A session URL is accepted only for `composio.dev` (or
the origin of `SQUIDBOT_COMPOSIO_API`). Per-agent grants live in
`<state>/squidbot/composio.json`. An agent with a grant record can call only
the tools that record names. A missing tool is refused and is not executed.

### Team files

```bash
squidbot templates export --name "Research" --agent Ada --instructions "…" --out ./team.md
squidbot templates import ./team.md
```

Export runs the credential masker. `sk-` and `ghp_` values do not survive.
Import adds new records only and rolls back if any part fails. Routines stay
paused (`enabledAfterInstall: false`).

## Flags for the unfinished wiring

These libraries are real and tested. They are not yet plugged through every
gateway screen. Set the variable to `1` to mark the phase on; the planners
then treat it as enabled.

| Variable | Phase | Still to wire |
|---|---|---|
| `SQUIDBOT_BOT_BOX` | 2 | Exec is wrapped. A live seccomp profile and unix-socket bridge are still open. |
| `SQUIDBOT_DESKTOPS` | 2 | Podman and SSH plans are observed. The Control UI does not yet embed the viewer. |
| `SQUIDBOT_ROOMS` | 3 | Room sessions and `/rooms` are wired. The caller injects the decision model. |
| `SQUIDBOT_PHONE_RELAY` | 4 | A listening relay process and a phone client. Mobile apps are not in this repo |

Boat cloud desktops and any paid hosted broker are not included. Nothing here
spends money or deploys.

## Tests

Squidbot's own tests do not need the full gateway install:

```bash
pnpm test:squidbot
```

The upstream suite is unchanged in how it is launched:

```bash
pnpm test
```

That suite is large. It needs `pnpm install` first. Squidbot tests live in
`src/squidbot/` and are excluded from the Vitest shards so they keep running
under Node's test runner.

## Licence

- Squidbot: Apache-2.0 (`LICENSE`).
- OpenClaw: MIT, kept at `third_party/openclaw/LICENSE`.
- OpenMausBot portions: Apache-2.0, kept at `third_party/openmausbot/LICENSE`.
- pi-mono: MIT, kept in `THIRD_PARTY_NOTICES.md`.
- T3 Code and Hermes Agent: MIT, under `third_party/`.

Ported and modified files start with `Adapted from <project> (<licence>), modified for Squidbot`. `src/squidbot/headers.test.ts` fails if that header is missing.

OpenClaw and OpenMausBot names in this README are attribution. They are not
the product name.
