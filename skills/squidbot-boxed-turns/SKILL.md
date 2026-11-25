---
name: squidbot-boxed-turns
description: Explain Squidbot boxed turns, the credential broker, and the public-address egress check. Off unless SQUIDBOT_BOT_BOX=1.
---

# Squidbot boxed turns

Boxed turns are off unless `SQUIDBOT_BOT_BOX=1`. The planner builds a
bubblewrap command and reports why it is off when the flag is unset or
`bwrap` is missing.

Real API keys stay in the gateway. The box receives a `sqd_t0_` token and a
base URL on the broker. The broker drops client credential headers, adds the
real header, and forwards only to the upstream stored with the grant. A wrong
token is 401. A missing grant is 403.

Egress allows public addresses only. Loopback, private ranges, and the cloud
metadata address are refused. Git pushes may create branches and new tags.
They may not delete a ref, move a tag, or update the default branch.
