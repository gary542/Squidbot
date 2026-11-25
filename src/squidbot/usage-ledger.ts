// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/usage-ledger.ts and server/usage-caps.ts @ 96ff8445.
// Modified: one NDJSON ledger under the Squidbot state dir, no enterprise budget path.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface UsageRow {
  at: string;
  threadId: string;
  botId: string;
  costUsd: number;
  input: number;
  output: number;
  cachedInput: number;
  /** Set on a counted miss when a cap or pause stopped the run before it spent. */
  missed?: string;
}

export function usageFileFor(dataDir: string, now: Date): string {
  const month = now.toISOString().slice(0, 7);
  return path.join(dataDir, "squidbot", "usage", `${month}.ndjson`);
}

export function isUsageRow(value: unknown): value is UsageRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<UsageRow>;
  return typeof row.at === "string" && typeof row.botId === "string";
}

export function readUsageRows(dataDir: string, now: Date): UsageRow[] {
  let text = "";
  try {
    text = readFileSync(usageFileFor(dataDir, now), "utf8");
  } catch {
    return [];
  }
  const rows: UsageRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isUsageRow(value)) rows.push(value);
    } catch {
      continue;
    }
  }
  return rows;
}

export function noteUsage(dataDir: string, row: UsageRow): void {
  const file = usageFileFor(dataDir, new Date(row.at));
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}
