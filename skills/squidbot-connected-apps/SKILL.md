---
name: squidbot-connected-apps
description: Use Squidbot connected apps with a self-hosted Composio project key and per-agent tool grants.
---

# Squidbot connected apps

Connected apps need the owner's Composio project key in
`SQUIDBOT_COMPOSIO_API_KEY` (`ak_…`). A personal `ck_` key is not a project
key. There is no hosted broker. If the key is empty, say that connected apps
are off.

Grants are per agent. No grant record means every connected tool (legacy).
The first grant switches that agent to an exact tool list. An empty list
means no tools. A call to a tool that is not granted is refused and must not
be retried with a different name.

Sandbox tools `COMPOSIO_REMOTE_WORKBENCH` and `COMPOSIO_REMOTE_BASH_TOOL` run
only at full access and only as a direct call.

Never invent an OAuth URL. Never put the project key in a transcript.
