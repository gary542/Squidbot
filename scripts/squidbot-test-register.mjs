// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: registers the TypeScript specifier hook for the Squidbot test run.

import { register } from "node:module";

register("./squidbot-ts-resolver.mjs", {
  parentURL: import.meta.url,
});
