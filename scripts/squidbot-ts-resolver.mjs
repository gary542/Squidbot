// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: resolve .js specifiers to .ts so node:test can run Squidbot sources without a compile.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
    const candidate = `${specifier.slice(0, -3)}.ts`;
    const target = fileURLToPath(new URL(candidate, context.parentURL));
    if (existsSync(target)) return nextResolve(candidate, context);
  }
  return nextResolve(specifier, context);
}
