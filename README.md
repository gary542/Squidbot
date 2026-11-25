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
| 2 | Wired, flag off | Exec uses bubblewrap when `SQUIDBOT_BOT_BOX=1`. The broker swaps `sqd_t0_` tokens for the real key and streams the upstream response. The seccomp allowlist permits ordinary file, process, and network calls on x86_64 and aarch64, and blocks ptrace, mount, kexec, bpf, and unshare. The broker socket is mounted into the box. With `SQUIDBOT_DESKTOPS=1`, Podman and SSH desktops start and stop, and the viewer is at `/desktops`. |
| 3 | Wired, flag off | With `SQUIDBOT_ROOMS=1`, the chosen bot runs an agent turn. Rooms are stored in sqlite. Rooms is in the Control UI sidebar. `SQUIDBOT_ROOM_DECIDER=model` asks the model who should answer, and the lead answers if that fails. |
| 4 | Wired, flag off | A loopback relay listens when `SQUIDBOT_PHONE_RELAY=1`. Pair with a short code, then the phone and computer speak Noise. The Android client claims the code, chats, and can unpair. The relay stores admission hashes and closes 4404 for everyone else. |

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
| `SQUIDBOT_BOT_BOX` | 2 | The broker proxies upstream. The seccomp allowlist covers x86_64 and aarch64. |
| `SQUIDBOT_DESKTOPS` | 2 | Podman and SSH desktops can be started and stopped. The viewer is at `/desktops`. |
| `SQUIDBOT_ROOMS` | 3 | Room turns, sqlite sessions, and the sidebar are wired. `SQUIDBOT_ROOM_DECIDER=model` is optional. |
| `SQUIDBOT_PHONE_RELAY` | 4 | Loopback unless `SQUIDBOT_PHONE_RELAY_BIND` is `lan` or `0.0.0.0`. An exposed relay uses a local TLS certificate. |

Boat cloud desktops and any paid hosted broker are not included. Nothing here
spends money or deploys.

## Phone app

The Android client is a second launcher icon named Squidbot inside `apps/android`.
The relay stays on `127.0.0.1:18790`. From a computer that is running the relay:

```bash
adb reverse tcp:18790 tcp:18790
```

An emulator then uses `127.0.0.1:18790` as if the relay were on the phone. Type the
8-character code, or paste `squidbot-phone:<code>`.

On the same Wi-Fi, set `SQUIDBOT_PHONE_RELAY_BIND=lan` and
`SQUIDBOT_PHONE_RELAY_ADVERTISE` to this computer's address. The relay prints a
warning, generates a certificate, and the QR looks like
`squidbot-phone://192.168.1.20:18790/CODE?fp=<sha256>`. The phone pins that
fingerprint. `SQUIDBOT_PHONE_RELAY_TLS=proxy` leaves TLS to a proxy you run.
That mode stays on the default loopback bind. An exposed bind always uses the
local certificate.

To reach the phone without opening a port, put both machines on a Tailscale
tailnet you already have and advertise the tailnet address. A Cloudflare
Tunnel has to be a TCP tunnel to `127.0.0.1:18790`, not an HTTP site, because
the relay is a framed socket. This tree does not create those accounts.

Each phone keeps a session
with the default agent (`SQUIDBOT_PHONE_AGENT` chooses another). Assistant
deltas are forwarded as they are produced. Stop ends the turn. A paused bot, a
spend cap, or a 300-turn loop shows a short message on the phone. Unpair
revokes the device. There is no Play Store build.

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
