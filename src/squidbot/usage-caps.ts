// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/usage-caps.ts @ 96ff8445.
// Modified: env prefix SQUIDBOT_, ledger helper from usage-ledger.ts, no enterprise budgets.

import { readUsageRows, type UsageRow } from "./usage-ledger.js";

export const CAP_WARN_PERCENT = 80;

export type CapPeriod = "day" | "month";
export type CapUnit = "usd" | "tokens";
export type CapStops = "unattended" | "everything";

export interface CapLimits {
  dailyUsd?: number;
  monthlyUsd?: number;
  dailyTokens?: number;
  monthlyTokens?: number;
}

export interface UsageCapsConfig {
  stops?: CapStops;
  server?: CapLimits;
  bots?: Record<string, CapLimits>;
}

export const CAP_FIELDS = [
  { field: "dailyUsd", period: "day", unit: "usd", env: "SQUIDBOT_USAGE_CAP_DAILY_USD" },
  { field: "monthlyUsd", period: "month", unit: "usd", env: "SQUIDBOT_USAGE_CAP_MONTHLY_USD" },
  { field: "dailyTokens", period: "day", unit: "tokens", env: "SQUIDBOT_USAGE_CAP_DAILY_TOKENS" },
  { field: "monthlyTokens", period: "month", unit: "tokens", env: "SQUIDBOT_USAGE_CAP_MONTHLY_TOKENS" },
] as const satisfies ReadonlyArray<{ field: keyof CapLimits; period: CapPeriod; unit: CapUnit; env: string }>;

export const CAP_STOPS_ENV = "SQUIDBOT_USAGE_CAP_STOPS";

export interface Used {
  usd: number;
  tokens: number;
}

export interface CapState {
  id: string;
  scope: "server" | "bot";
  botId?: string;
  period: CapPeriod;
  unit: CapUnit;
  limit: number;
  used: number;
  percent: number;
  warn: boolean;
  reached: boolean;
  periodKey: string;
  resetsAt: number;
}

const DAY_MS = 24 * 60 * 60_000;
const positive = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Fresh input plus output. Cached input is removed from the input count, matching the usage bars. */
export function capTokens(row: Pick<UsageRow, "input" | "output" | "cachedInput">): number {
  const input = positive(row.input);
  return Math.max(0, input - Math.min(positive(row.cachedInput), input)) + positive(row.output);
}

export const dayKey = (now: Date): string => now.toISOString().slice(0, 10);
export const monthKeyOf = (now: Date): string => now.toISOString().slice(0, 7);

export function periodEnd(period: CapPeriod, now: Date): number {
  return period === "day"
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

export function measure(limit: number, used: number, warnAtPercent = CAP_WARN_PERCENT) {
  const percent = Math.min(999, Math.round((used / limit) * 100));
  return { percent, warn: percent >= warnAtPercent, reached: used >= limit };
}

function numberFrom(raw: string | undefined, whole: boolean): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && (!whole || Number.isInteger(value)) ? value : undefined;
}

export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): { stops?: CapStops; server: CapLimits } {
  const server: CapLimits = {};
  for (const { field, unit, env: name } of CAP_FIELDS) {
    const value = numberFrom(env[name], unit === "tokens");
    if (value !== undefined) server[field] = value;
  }
  const stops = env[CAP_STOPS_ENV]?.trim().toLowerCase();
  return { ...(stops === "unattended" || stops === "everything" ? { stops } : {}), server };
}

export function effectiveCaps(saved: UsageCapsConfig | undefined, env: NodeJS.ProcessEnv = process.env) {
  const fromEnv = capsFromEnv(env);
  return {
    stops: fromEnv.stops ?? saved?.stops ?? "unattended",
    server: { ...saved?.server, ...fromEnv.server },
    bots: saved?.bots ?? {},
  };
}

function zero(): Record<CapPeriod, Used> {
  return { day: { usd: 0, tokens: 0 }, month: { usd: 0, tokens: 0 } };
}

export function usageTotals(dataDir: string, now = new Date()) {
  const month = monthKeyOf(now);
  const day = dayKey(now);
  const server = zero();
  const bots = new Map<string, Record<CapPeriod, Used>>();
  for (const row of readUsageRows(dataDir, now)) {
    if (!row.at.startsWith(month) || row.missed) continue;
    const bot = bots.get(row.botId) ?? zero();
    bots.set(row.botId, bot);
    const targets = row.at.startsWith(day)
      ? [server.month, bot.month, server.day, bot.day]
      : [server.month, bot.month];
    const usd = positive(row.costUsd);
    const tokens = capTokens(row);
    for (const used of targets) {
      used.usd += usd;
      used.tokens += tokens;
    }
  }
  return { month, day, server, bots };
}

function statesOf(
  scope: "server" | "bot",
  botId: string | undefined,
  limits: CapLimits | undefined,
  used: Record<CapPeriod, Used> | undefined,
  now: Date,
): CapState[] {
  const states: CapState[] = [];
  for (const { field, period, unit } of CAP_FIELDS) {
    const limit = limits?.[field];
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) continue;
    const spent = used?.[period][unit] ?? 0;
    states.push({
      id: `${scope === "bot" ? `bot:${botId}` : "server"}:${period}:${unit}`,
      scope,
      ...(botId ? { botId } : {}),
      period,
      unit,
      limit,
      used: spent,
      ...measure(limit, spent),
      periodKey: period === "day" ? dayKey(now) : monthKeyOf(now),
      resetsAt: periodEnd(period, now),
    });
  }
  return states;
}

export function capStates(
  saved: UsageCapsConfig | undefined,
  dataDir: string,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  botId?: string,
): CapState[] {
  const caps = effectiveCaps(saved, env);
  const bots = Object.entries(caps.bots).filter(([id]) => botId === undefined || id === botId);
  if (!bots.length && !CAP_FIELDS.some(({ field }) => (caps.server[field] ?? 0) > 0)) return [];
  const totals = usageTotals(dataDir, now);
  return [
    ...statesOf("server", undefined, caps.server, totals.server, now),
    ...bots.flatMap(([id, limits]) => statesOf("bot", id, limits, totals.bots.get(id), now)),
  ];
}

export function blockingCap(states: readonly CapState[]): CapState | null {
  return states.reduce<CapState | null>(
    (blocking, state) => (state.reached && (!blocking || state.resetsAt > blocking.resetsAt) ? state : blocking),
    null,
  );
}

/** A person's own message is stopped only when stops is `everything`. */
export function reachedCap(
  saved: UsageCapsConfig | undefined,
  dataDir: string,
  work: { botId?: string; personWaiting: boolean },
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): CapState | null {
  if (work.personWaiting && effectiveCaps(saved, env).stops !== "everything") return null;
  return blockingCap(capStates(saved, dataDir, now, env, work.botId ?? ""));
}

export function capRefusal(state: CapState): { status: 409; code: "spend_cap"; message: string } {
  const when = new Date(state.resetsAt).toISOString();
  return {
    status: 409,
    code: "spend_cap",
    message: `Spend cap reached (${state.id}, ${state.used}/${state.limit} ${state.unit}). Resets at ${when}.`,
  };
}
