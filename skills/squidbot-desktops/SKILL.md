---
name: squidbot-desktops
description: Choose a per-agent desktop and respect the take-control lease. Live desktops stay behind SQUIDBOT_DESKTOPS=1.
---

# Squidbot desktops

Live desktops (local container, SSH, this machine) stay off unless
`SQUIDBOT_DESKTOPS=1`. Boat cloud VMs are not included.

The person's choice of computer wins when that place is ready. Otherwise the
bot stays on its current computer. A bot does not move its own work.

While a person holds take-control, bot clicks are refused and not queued.
Viewer input is refused while the bot holds the desktop. The RFB filter drops
key, pointer, and cut-text messages unless that viewer may give input.
