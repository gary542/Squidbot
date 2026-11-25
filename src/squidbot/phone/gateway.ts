// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the gateway starts the phone relay only when SQUIDBOT_PHONE_RELAY=1.

import { startPhoneRelay, type PhoneRelay } from "./listener.js";

let active: PhoneRelay | undefined;

export function phoneRelayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SQUIDBOT_PHONE_RELAY === "1";
}

/** Null when the flag is off. The listener binds loopback and never logs device tokens. */
export async function startPhoneRelayFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PhoneRelay | null> {
  if (!phoneRelayEnabled(env)) return null;
  if (active) return active;
  const parsed = Number(env.SQUIDBOT_PHONE_RELAY_PORT ?? 18790);
  const port = Number.isInteger(parsed) && parsed >= 0 && parsed < 65536 ? parsed : 18790;
  active = await startPhoneRelay({ port });
  return active;
}

export async function stopPhoneRelay(): Promise<void> {
  const current = active;
  active = undefined;
  await current?.close();
}
