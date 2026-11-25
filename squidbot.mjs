#!/usr/bin/env node
// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: product command. Sets SQUIDBOT_CLI so the banner and Commander name say Squidbot.

process.env.SQUIDBOT_CLI = "1";
await import("./openclaw.mjs");
