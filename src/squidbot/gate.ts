// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/host/usage-cap-gate.ts @ 96ff8445.
// Modified: one admission check for chat, cron, and hand-offs. 409 spend_cap or bot_held.

import { existsSync } from "node:fs";
import path from "node:path";
import { readCapsConfig } from "./caps-config.js";
import { holdForAgent } from "./pause.js";
import { squidbotStateDir } from "./state-dir.js";
import { capsFromEnv, capRefusal, reachedCap } from "./usage-caps.js";

export interface RunAdmissionInput {
  agentId?: string;
  /** `user` is a person waiting. `cron` and `heartbeat` are unattended. */
  trigger?: string;
  senderIsOwner?: boolean;
  /** A hand-off whose requester is paused must not be routed around. */
  handoff?: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
}

export interface RunAdmissionHold {
  status: 409;
  code: "spend_cap" | "bot_held";
  message: string;
}

export function personIsWaiting(input: RunAdmissionInput): boolean {
  if (input.handoff) return false;
  const trigger = input.trigger ?? "user";
  return trigger === "user" || trigger === "manual";
}

/** Null when the run may start. Never throws: a missing state dir means nothing is capped or paused. */
export function evaluateRunAdmission(input: RunAdmissionInput = {}): RunAdmissionHold | null {
  const env = input.env ?? process.env;
  const dataDir = input.stateDir ?? squidbotStateDir(env);
  const now = input.now ?? new Date();
  const configured = Boolean(input.stateDir) || existsSync(path.join(dataDir, "squidbot")) || capsFromEnv(env).stops !== undefined || Object.keys(capsFromEnv(env).server).length > 0;
  if (!configured) return null;
  const held = holdForAgent(dataDir, input.agentId);
  if (held) {
    return held;
  }
  const saved = readCapsConfig(dataDir);
  const cap = reachedCap(saved, dataDir, { botId: input.agentId, personWaiting: personIsWaiting(input) }, now, env);
  if (!cap) return null;
  return capRefusal(cap);
}
