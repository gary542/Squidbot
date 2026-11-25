// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/bot-box/broker.ts @ 96ff8445.
// Modified: in-process token table. Real keys stay here; the box only sees sqd_t0_ tokens.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const BROKER_TOKEN_PREFIX = "sqd_t0_";
export const BROKER_TTL_MS = 24 * 60 * 60_000;

export interface BrokerGrant {
  upstream: string;
  headers: Record<string, string>;
}

interface TokenRecord {
  hash: Buffer;
  agentId: string;
  conversationId: string;
  expiresAt: number;
  grants: Record<string, BrokerGrant>;
}

const tokens = new Map<string, TokenRecord>();

export function resetBroker(): void {
  tokens.clear();
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function mintBrokerToken(input: {
  agentId: string;
  conversationId: string;
  grants: Record<string, BrokerGrant>;
  now?: number;
  ttlMs?: number;
}): { token: string; expiresAt: number } {
  const now = input.now ?? Date.now();
  const token = BROKER_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const expiresAt = now + (input.ttlMs ?? BROKER_TTL_MS);
  tokens.set(token, {
    hash: hashToken(token),
    agentId: input.agentId,
    conversationId: input.conversationId,
    expiresAt,
    grants: input.grants,
  });
  return { token, expiresAt };
}

export function revokeBrokerToken(token: string): void {
  tokens.delete(token);
}

export interface BrokerForward {
  status: number;
  upstream?: string;
  headers?: Record<string, string>;
  error?: string;
}

const CREDENTIAL_HEADERS = new Set(["authorization", "x-api-key", "api-key"]);

/** Strips client credentials, adds the grant's real headers, and pins the upstream. */
export function authorizeBrokerCall(input: {
  token: string;
  grant: string;
  clientHeaders?: Record<string, string>;
  now?: number;
}): BrokerForward {
  const record = tokens.get(input.token);
  const now = input.now ?? Date.now();
  if (!record || !timingSafeEqual(record.hash, hashToken(input.token)) || record.expiresAt <= now) {
    return { status: 401, error: "unknown or expired broker token" };
  }
  const grant = record.grants[input.grant];
  if (!grant) return { status: 403, error: "missing grant" };
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.clientHeaders ?? {})) {
    if (!CREDENTIAL_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  for (const [name, value] of Object.entries(grant.headers)) headers[name] = value;
  return { status: 200, upstream: grant.upstream, headers };
}

/** The key must not appear in the environment handed to the box. */
export function boxEnv(realEnv: Record<string, string | undefined>, token: string, brokerBase: string): Record<string, string> {
  const allow = ["PATH", "HOME", "LANG", "TERM", "TMPDIR"];
  const out: Record<string, string> = {};
  for (const name of allow) {
    const value = realEnv[name];
    if (value) out[name] = value;
  }
  out.ANTHROPIC_BASE_URL = `${brokerBase}/b/${token}/anthropic`;
  out.OPENAI_BASE_URL = `${brokerBase}/b/${token}/openai`;
  out.ANTHROPIC_API_KEY = token;
  out.OPENAI_API_KEY = token;
  return out;
}

export function selfCheckBroker(input: {
  realKey: string;
  boxEnvironment: Record<string, string>;
  token: string;
  grant: string;
}): { keyAbsent: boolean; wrongTokenStatus: number; goodStatus: number } {
  const blob = JSON.stringify(input.boxEnvironment);
  const wrong = authorizeBrokerCall({ token: "sqd_t0_not-a-real-token", grant: input.grant });
  const good = authorizeBrokerCall({ token: input.token, grant: input.grant, clientHeaders: { authorization: "Bearer stolen" } });
  return {
    keyAbsent: !blob.includes(input.realKey),
    wrongTokenStatus: wrong.status,
    goodStatus: good.status,
  };
}
