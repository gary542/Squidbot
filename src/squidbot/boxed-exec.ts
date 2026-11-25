// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/bot-box/plan.ts and server/bot-box/broker.ts @ 96ff8445.
// Modified: gateway exec wrapper. Bubblewrap when it is installed, otherwise a host fallback that still swaps keys for tokens.

import { existsSync } from "node:fs";
import path from "node:path";
import { boxEnv, mintBrokerToken, resetBroker, type BrokerGrant } from "./broker.js";
import { ensureBrokerBase } from "./broker-server.js";
import { planBwrap } from "./bwrap.js";

const PROVIDERS = [
  { env: "ANTHROPIC_API_KEY", grant: "anthropic", upstream: "https://api.anthropic.com", header: "x-api-key" },
  { env: "ANTHROPIC_AUTH_TOKEN", grant: "anthropic-auth", upstream: "https://api.anthropic.com", header: "authorization" },
  { env: "OPENAI_API_KEY", grant: "openai", upstream: "https://api.openai.com", header: "authorization" },
  { env: "GEMINI_API_KEY", grant: "gemini", upstream: "https://generativelanguage.googleapis.com", header: "x-goog-api-key" },
  { env: "GOOGLE_API_KEY", grant: "google", upstream: "https://generativelanguage.googleapis.com", header: "x-goog-api-key" },
] as const;

export interface BoxedExecInput {
  command: string;
  agentId?: string;
  sessionKey?: string;
  workspace?: string;
  env?: NodeJS.ProcessEnv;
  bwrapPath?: string;
  brokerBase?: string;
}

export type BoxedExecResult =
  | { action: "skip" }
  | {
      action: "apply";
      command: string;
      env: Record<string, string>;
      mode: "bwrap" | "host-broker";
      reason: string;
      token: string;
    };

export function findBwrap(env: NodeJS.ProcessEnv, explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const fromEnv = env.SQUIDBOT_BWRAP_PATH?.trim();
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "bwrap");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function grantsFromEnv(env: NodeJS.ProcessEnv): Record<string, BrokerGrant> {
  const grants: Record<string, BrokerGrant> = {};
  for (const provider of PROVIDERS) {
    const value = env[provider.env]?.trim();
    if (!value) continue;
    const headerValue = provider.header === "authorization" && !value.startsWith("Bearer ") ? `Bearer ${value}` : value;
    grants[provider.grant] = { upstream: provider.upstream, headers: { [provider.header]: headerValue } };
  }
  return grants;
}

export async function prepareBoxedExec(input: BoxedExecInput): Promise<BoxedExecResult> {
  const env = input.env ?? process.env;
  if (env.SQUIDBOT_BOT_BOX !== "1") return { action: "skip" };
  const grants = grantsFromEnv(env);
  let brokerBase = input.brokerBase;
  let brokerReason = "";
  if (!brokerBase) {
    try {
      brokerBase = await ensureBrokerBase();
    } catch {
      brokerBase = "http://127.0.0.1:9";
      brokerReason = "broker did not bind; calls fail closed";
    }
  }
  const minted = mintBrokerToken({
    agentId: input.agentId ?? "main",
    conversationId: input.sessionKey ?? "exec",
    grants,
  });
  const childEnv = boxEnv(env, minted.token, brokerBase);
  delete childEnv.PATH;
  const realKeys = PROVIDERS.map((provider) => env[provider.env]).filter((value): value is string => Boolean(value));
  for (const key of realKeys) {
    if (JSON.stringify(childEnv).includes(key)) {
      throw new Error("Squidbot broker leaked a provider key into the child environment.");
    }
  }
  const bwrap = findBwrap(env, input.bwrapPath);
  const workspace = input.workspace && input.workspace.startsWith("/") ? input.workspace : "/tmp";
  if (!bwrap) {
    return {
      action: "apply",
      command: input.command,
      env: childEnv,
      mode: "host-broker",
      reason: brokerReason || "bwrap is not installed; keys were swapped for broker tokens without a namespace",
      token: minted.token,
    };
  }
  const plan = planBwrap({
    command: ["bash", "-lc", input.command],
    workspace,
    env: { ...env, SQUIDBOT_BOT_BOX: "1" },
    bwrapPath: bwrap,
  });
  if (!plan.enabled || plan.argv.length === 0) {
    return {
      action: "apply",
      command: input.command,
      env: childEnv,
      mode: "host-broker",
      reason: plan.reason || brokerReason || "bwrap plan was not available",
      token: minted.token,
    };
  }
  const argv = [
    plan.argv[0]!,
    "--clearenv",
    ...Object.entries(childEnv).flatMap(([name, value]) => ["--setenv", name, value]),
    ...plan.argv.slice(1),
  ];
  return {
    action: "apply",
    command: argv.map(quoteArg).join(" "),
    env: childEnv,
    mode: "bwrap",
    reason: brokerReason || "planned",
    token: minted.token,
  };
}

export { resetBroker };
