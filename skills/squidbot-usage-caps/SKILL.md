---
name: squidbot-usage-caps
description: Check or set Squidbot daily and monthly spend caps, and pause or resume an agent.
---

# Squidbot usage caps and pause

Caps are UTC daily and monthly limits in dollars or tokens, for the whole
gateway and per agent. Empty or 0 means no cap. Environment values win over
the saved file.

- `SQUIDBOT_USAGE_CAP_DAILY_USD`
- `SQUIDBOT_USAGE_CAP_MONTHLY_USD`
- `SQUIDBOT_USAGE_CAP_DAILY_TOKENS`
- `SQUIDBOT_USAGE_CAP_MONTHLY_TOKENS`
- `SQUIDBOT_USAGE_CAP_STOPS` is `unattended` (default) or `everything`

`unattended` still lets a person's own message through. `everything` stops
that too. Cron and heartbeats count as unattended. A reached cap is a 409
`spend_cap`. Pause is a 409 `bot_held` and blocks new work, including a
person's message, until resume.

```bash
squidbot agents caps --agent main
squidbot agents pause main
squidbot agents resume main
squidbot agents resume --all
```

Tell a hand-off that a paused teammate is paused. Do not route around it.
