---
name: squidbot-team-packages
description: Export or import a Squidbot team file. Export scrubs secrets. Import rolls back on failure.
---

# Squidbot team packages

A team file is Markdown with JSON frontmatter, `botmrr: 2`, a name, agents,
optional rooms, and routines. Routines must say `enabledAfterInstall: false`.

```bash
squidbot templates export --name "Research" --agent Ada --instructions "…" --out ./team.md
squidbot templates import ./team.md
```

Export removes credential-shaped strings (`sk-`, `ghp_`, and the other
prefixes the masker knows). Do not put chats, memory, keys, approval levels,
or computer addresses in a team file. Import only adds records. If any part
fails, the whole import is rolled back.
