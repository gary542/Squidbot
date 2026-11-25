---
name: squidbot-rooms
description: Route a room message to one agent, or fall back to the room lead. The session controller wiring stays behind SQUIDBOT_ROOMS=1.
---

# Squidbot rooms

Room sessions in the gateway stay off unless `SQUIDBOT_ROOMS=1`. The router
itself is available to tests and to a decision-model caller.

Ask which member should answer. Choose `__everyone__` only when several
members must answer. A probability under 0.6, or an answer slower than 1.5
seconds, falls back to the room lead.

Hand-offs are assignment records. The tree stops at depth 4, at 300 turns,
and after 5 failures in a row. The same brief to the same assignee under one
parent is one request unless it is marked rework.
