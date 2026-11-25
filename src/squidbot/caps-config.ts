// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/usage-caps-config.ts @ 96ff8445. Modified: JSON file, Squidbot paths.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UsageCapsConfig } from "./usage-caps.js";

export function capsConfigFile(dataDir: string): string {
  return path.join(dataDir, "squidbot", "usage-caps.json");
}

export function readCapsConfig(dataDir: string): UsageCapsConfig {
  try {
    const value: unknown = JSON.parse(readFileSync(capsConfigFile(dataDir), "utf8"));
    if (!value || typeof value !== "object") return {};
    return value as UsageCapsConfig;
  } catch {
    return {};
  }
}

export function writeCapsConfig(dataDir: string, config: UsageCapsConfig): void {
  const file = capsConfigFile(dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, file);
}
